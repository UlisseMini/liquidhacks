"""Enrich hackathon winner data using Tavily search.

One Tavily call per devpost project: finds exact prize info + team contact details.
"""

import json
import os
import re
import time
import sys
from pathlib import Path

from dotenv import load_dotenv
from tavily import TavilyClient

load_dotenv()

_print = print
def print(*args, **kwargs):
    _print(*args, **kwargs, flush=True)


def clean_url(url: str) -> str:
    """Fix malformed URLs like https://github.com/https://github.com/user
    or https://twitter.com/http://x.com/user."""
    # Split on http:// or https:// boundaries
    parts = re.split(r'(?=https?://)', url)
    parts = [p for p in parts if p]  # remove empty strings
    if len(parts) >= 2:
        # Return the last embedded URL
        return parts[-1]
    return url


def extract_contacts_from_text(full_text: str) -> dict:
    """Extract all contact info from a text block."""
    contacts: dict = {}

    # Email
    emails = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', full_text)
    for e in emails:
        if not any(x in e.lower() for x in ["example.com", "devpost", "sentry", "cloudfront",
                                              "github", "noreply", "gravatar", "badge"]):
            contacts["email"] = e
            break

    # LinkedIn
    lins = re.findall(r'https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9_-]+/?', full_text)
    if lins:
        contacts["linkedin"] = lins[0]

    # Twitter/X
    twits = re.findall(r'https?://(?:www\.)?(?:twitter|x)\.com/[a-zA-Z0-9_]+', full_text)
    for t in twits:
        if not any(skip in t.lower() for skip in ["/devpost", "/share", "/intent", "/home", "/search"]):
            contacts["twitter"] = clean_url(t)
            break

    # Discord - require at least 3 chars username, not common words
    discs = re.findall(r'(?:discord[:\s]+)([a-zA-Z0-9_.]{3,}(?:#\d{4})?)', full_text, re.I)
    noise_words = {"server", "channel", "open", "join", "link", "invite", "the", "our", "and",
                    "bot", "app", "api", "new", "roo", "for", "has", "not", "can", "foresee",
                    "this", "that", "with", "also", "from", "here", "more", "see", "use"}
    for d in discs:
        if d.lower() not in noise_words:
            contacts["discord"] = d
            break

    # GitHub
    ghs = re.findall(r'https?://(?:www\.)?github\.com/[a-zA-Z0-9_-]+', full_text)
    for g in ghs:
        if not any(skip in g.lower() for skip in ["/orgs", "/topics", "/software", "/issues",
                                                    "/pulls", "/actions", "/settings"]):
            contacts["github"] = clean_url(g)
            break

    return contacts


def extract_contact_for_member(results: list[dict], member_name: str) -> dict:
    """Extract contact info for a specific member from search results."""
    contacts: dict = {}
    name_lower = member_name.lower().strip()
    # Skip names that look like usernames (have digits or weird chars)
    parts = name_lower.split()
    if len(parts) < 2:
        return contacts  # need at least first + last name for reliable matching

    for r in results:
        full_text = (r.get("content") or "") + " " + (r.get("raw_content") or "")
        text_lower = full_text.lower()

        # Require full name match for email/phone (high false-positive risk)
        # Allow first-name match for LinkedIn/GitHub/Twitter (URL context helps)
        has_full_name = name_lower in text_lower
        has_first_name = parts[0] in text_lower

        if not has_full_name and not has_first_name:
            continue

        found = extract_contacts_from_text(full_text)

        for key, val in found.items():
            if key not in contacts:
                # For email/phone, require full name match to avoid false positives
                if key in ("email", "phone") and not has_full_name:
                    continue
                contacts[key] = val

    return contacts


def enrich_project(client: TavilyClient, project: dict) -> dict:
    """Enrich a single project with Tavily search results."""
    hackathon = project.get("hackathon", "")
    title = project.get("title", "")
    members = [m["name"] for m in project.get("team_members", [])
               if m.get("name") and not m["name"].startswith("http")]
    members_str = ", ".join(members[:4])

    query = f'{hackathon} "{title}" winners prize {members_str} email linkedin contact'[:390]

    try:
        response = client.search(
            query=query,
            search_depth="advanced",
            max_results=5,
            include_raw_content="text",
            include_answer="advanced",
            topic="general",
        )
    except Exception as e:
        print(f"    Tavily error: {e}")
        return project

    results = response.get("results", [])
    answer = response.get("answer", "")

    # Store the Tavily answer - it's the best summary of what they won
    if answer:
        project["tavily_summary"] = answer

    # Extract structured prize info primarily from the answer (most reliable)
    # Only use results that are about this specific project
    title_lower = title.lower()
    relevant_texts = [answer] if answer else []
    for r in results:
        content = (r.get("content") or "")
        if title_lower in content.lower() or any(
            m.lower() in content.lower() for m in members[:3] if m
        ):
            relevant_texts.append(content)
    all_text = "\n".join(relevant_texts)
    # Clean text for regex
    all_text = all_text.replace("\n", " ").replace("\r", " ")
    prize_details = []

    # Dollar amounts with context
    for m in re.finditer(r'\$[\d,]+(?:\.\d+)?(?:\s*(?:k|K|USD|CAD))?\s*(?:worth\s+of\s+\w+(?:\s+\w+)?|in\s+\w+(?:\s+\w+)?)?', all_text):
        val = m.group().strip()
        # Skip tiny amounts likely noise
        raw_num = re.search(r'[\d,]+', val)
        if raw_num:
            num = float(raw_num.group().replace(",", ""))
            if num < 5:
                continue
        if val and val not in prize_details:
            prize_details.append(val)

    # Placement prizes - extract clean versions
    for m in re.finditer(r'(?:1st|2nd|3rd|first|second|third)\s+(?:place|overall)', all_text, re.I):
        val = m.group().strip()
        if val not in prize_details:
            prize_details.append(val)

    # Named category prizes (Best Use of X, etc.)
    for m in re.finditer(
        r'(?:Best\s+(?:Use\s+of\s+|Overall|Hack|Design|Innovation|Impact)\w*(?:\s+\w+){0,4}|'
        r'(?:Grand|Top|Runner.Up|Honorable\s+Mention|Special)\s+(?:Prize|Award|Winner)(?:\s+\w+){0,3})',
        all_text, re.I
    ):
        val = m.group().strip().rstrip(",;:")
        if val and val not in prize_details and len(val) > 5:
            prize_details.append(val)

    # Hardware prizes
    for m in re.finditer(
        r'(?:ASUS|ROG)\s+\w+(?:\s+\w+){0,3}|'
        r'(?:MacBook|iPad|Fitbit|Keychron|Arduino|Raspberry\s+Pi)\s*\w*',
        all_text, re.I
    ):
        val = m.group().strip()
        if val and val not in prize_details:
            prize_details.append(val)

    # API credits
    for m in re.finditer(r'\$?[\d,]+\s+(?:in\s+)?(?:\w+\s+)?(?:API\s+)?credits', all_text, re.I):
        val = m.group().strip()
        if val and val not in prize_details:
            prize_details.append(val)

    # Clean up prize details - remove duplicates and overly long entries
    cleaned_prizes = []
    for p in prize_details:
        p = p.strip()
        # Truncate at natural boundary if too long
        if len(p) > 60:
            # Try to cut at a word boundary
            p = p[:60].rsplit(" ", 1)[0]
        if p and p not in cleaned_prizes and len(p) >= 3:
            cleaned_prizes.append(p)
    if cleaned_prizes:
        project["prize_details"] = cleaned_prizes

    # Enrich each team member's contact info
    for member in project.get("team_members", []):
        # Clean any existing malformed URLs
        for url_key in ("github", "twitter", "linkedin"):
            if member.get(url_key):
                member[url_key] = clean_url(member[url_key])

        name = member.get("name", "")
        if not name:
            continue
        new_contacts = extract_contact_for_member(results, name)
        for key, val in new_contacts.items():
            if key not in member or not member[key]:
                member[key] = clean_url(val) if "://" in val else val

    return project


def main():
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        print("ERROR: Set TAVILY_API_KEY in .env")
        sys.exit(1)

    client = TavilyClient(api_key=api_key)

    # Load existing data
    data_path = Path("hackathon_winners.json")
    if not data_path.exists():
        print("ERROR: Run scrape.py first to generate hackathon_winners.json")
        sys.exit(1)

    projects = json.load(open(data_path))
    print(f"Loaded {len(projects)} projects")

    # Filter to only projects with prizes (winners)
    winners = [p for p in projects if p.get("prizes")]
    print(f"Projects with prizes: {len(winners)}")

    # Check which ones already have enrichment
    already_enriched = [p for p in winners if p.get("tavily_summary")]
    need_enrichment = [p for p in winners if not p.get("tavily_summary")]
    print(f"Already enriched: {len(already_enriched)}")
    print(f"Need enrichment: {len(need_enrichment)}")

    if not need_enrichment:
        print("All winners already enriched!")
        return

    # Enrichment costs ~2 credits per call (advanced search + advanced answer)
    estimated_credits = len(need_enrichment) * 2
    print(f"\nWill use ~{estimated_credits} Tavily credits ({len(need_enrichment)} searches)")
    print(f"Free tier: 1000 credits/month\n")

    # Build index for updating in-place
    url_to_idx = {p["url"]: i for i, p in enumerate(projects)}

    enriched = 0
    for i, project in enumerate(need_enrichment):
        title = project.get("title", "???")
        hackathon = project.get("hackathon", "???")
        print(f"[{i+1}/{len(need_enrichment)}] {hackathon} / {title}")

        enriched_project = enrich_project(client, project)

        # Show what we found
        summary = enriched_project.get("tavily_summary", "")
        if summary:
            print(f"    Prize: {summary[:120]}")
        prize_details = enriched_project.get("prize_details", [])
        if prize_details:
            print(f"    Details: {prize_details[:3]}")
        for m in enriched_project.get("team_members", []):
            found = {k: v for k, v in m.items()
                     if k in ("email", "linkedin", "twitter", "discord", "phone") and v}
            if found:
                print(f"    {m['name']}: {found}")

        # Update in the full list
        idx = url_to_idx.get(project["url"])
        if idx is not None:
            projects[idx] = enriched_project

        enriched += 1

        # Save periodically
        if enriched % 10 == 0:
            with open(data_path, "w") as f:
                json.dump(projects, f, indent=2)
            print(f"  --- saved progress: {enriched} enriched ---")

        # Rate limit: 100 RPM for search
        time.sleep(1.0)

    # Final save
    with open(data_path, "w") as f:
        json.dump(projects, f, indent=2)
    print(f"\nSaved enriched data to {data_path}")

    # Summary
    print("\n=== Enrichment Summary ===")
    all_winners = [p for p in projects if p.get("prizes")]
    with_prize_details = sum(1 for p in all_winners if p.get("prize_details"))
    with_summary = sum(1 for p in all_winners if p.get("tavily_summary"))
    total_members = sum(len(p.get("team_members", [])) for p in all_winners)

    contact_counts = {"email": 0, "linkedin": 0, "twitter": 0, "discord": 0, "github": 0, "phone": 0}
    for p in all_winners:
        for m in p.get("team_members", []):
            for key in contact_counts:
                if m.get(key):
                    contact_counts[key] += 1

    print(f"Winners enriched: {with_summary}/{len(all_winners)}")
    print(f"With detailed prize info: {with_prize_details}")
    print(f"Total team members: {total_members}")
    for key, count in contact_counts.items():
        print(f"  With {key}: {count}")


if __name__ == "__main__":
    main()
