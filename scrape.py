"""Scrape devpost for recent hackathon participants and their contact info."""

import httpx
import json
import csv
import time
import re
import sys
from bs4 import BeautifulSoup
from pathlib import Path

# Unbuffered prints
_print = print
def print(*args, **kwargs):
    _print(*args, **kwargs, flush=True)

BASE = "https://devpost.com"
API_HACKATHONS = f"{BASE}/api/hackathons"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Devpost profile paths that are NOT user profiles
NOT_PROFILES = {
    "software", "hackathons", "api", "", "about", "portfolio", "challenges",
    "settings", "search", "users", "teams", "notifications", "submissions",
}


def get_recent_hackathons(n_pages: int = 3) -> list[dict]:
    """Get recently ended hackathons from the devpost API."""
    hackathons = []
    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=30) as client:
        for page in range(1, n_pages + 1):
            print(f"  Fetching hackathons page {page}...")
            resp = client.get(API_HACKATHONS, params={
                "status": "ended",
                "order_by": "recently-ended",
                "page": page,
            })
            resp.raise_for_status()
            data = resp.json()
            for h in data.get("hackathons", []):
                hackathons.append({
                    "title": h.get("title"),
                    "url": h.get("url"),
                    "organization": h.get("organization_name"),
                    "prize_amount": h.get("prize_amount"),
                    "registrations": h.get("registrations_count"),
                    "submission_gallery_url": h.get("submission_gallery_url"),
                    "winners_announced": h.get("winners_announced"),
                    "submission_dates": h.get("submission_period_dates"),
                })
            time.sleep(0.5)
    return hackathons


def get_gallery_projects(gallery_url: str, max_pages: int = 2) -> list[str]:
    """Get project URLs from a hackathon's project gallery."""
    project_urls = []
    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=30) as client:
        for page in range(1, max_pages + 1):
            url = f"{gallery_url}?page={page}"
            print(f"    Gallery page {page}...")
            try:
                resp = client.get(url)
                resp.raise_for_status()
            except Exception as e:
                print(f"    Error: {e}")
                break

            soup = BeautifulSoup(resp.text, "lxml")
            links = soup.find_all("a", href=re.compile(r"^https?://devpost\.com/software/"))
            page_urls = []
            for link in links:
                href = link["href"]
                if href not in project_urls and href not in page_urls:
                    page_urls.append(href)

            if not page_urls:
                break
            project_urls.extend(page_urls)
            print(f"    Found {len(page_urls)} projects")
            time.sleep(0.5)
    return project_urls


def is_user_profile_link(href: str) -> bool:
    """Check if a devpost URL is a user profile link."""
    if not re.match(r"^https?://devpost\.com/[a-zA-Z0-9._-]+$", href):
        return False
    username = href.rstrip("/").split("/")[-1]
    return username.lower() not in NOT_PROFILES and len(username) > 1


def scrape_project(url: str, client: httpx.Client) -> dict | None:
    """Scrape a single project page for team info, links, prizes."""
    try:
        resp = client.get(url)
        resp.raise_for_status()
    except Exception as e:
        print(f"      Error scraping {url}: {e}")
        return None

    soup = BeautifulSoup(resp.text, "lxml")
    project: dict = {"url": url, "team_members": [], "links": {}, "prizes": []}

    # Title
    title_el = soup.find("h1", id="app-title") or soup.find("h1")
    project["title"] = title_el.get_text(strip=True) if title_el else ""

    # Tagline
    tagline_el = soup.find("p", class_="large") or soup.select_one("#app-details-left p")
    project["tagline"] = tagline_el.get_text(strip=True) if tagline_el else ""

    # Links from data-role="software-urls" section (most reliable)
    urls_section = soup.find(attrs={"data-role": "software-urls"})
    if urls_section:
        for a in urls_section.find_all("a", href=True):
            href = a["href"]
            if "github.com" in href:
                project["links"]["github"] = href
            else:
                project["links"]["demo"] = href

    # Fallback: scan all links for github/youtube
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "github.com" in href and "github" not in project["links"]:
            project["links"]["github"] = href
        elif "youtu" in href:
            project["links"]["youtube"] = href

    # Team members - find devpost profile links
    # First pass: collect all profile URLs with their best name
    profile_names: dict[str, str] = {}
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if not is_user_profile_link(href):
            continue
        name = link.get_text(strip=True)
        # Skip empty/invalid names
        if not name or len(name) <= 1 or name.startswith("http") or name.startswith("/"):
            continue
        if name.lower() in ("settings", "log in", "sign up", "login", "register"):
            continue
        # Keep the longest name for each profile (more likely to be full name)
        if href not in profile_names or len(name) > len(profile_names[href]):
            profile_names[href] = name

    for href, name in profile_names.items():
        project["team_members"].append({
            "name": name,
            "devpost_profile": href,
        })

    # Prizes / winner status
    for tag in soup.find_all(class_=re.compile(r"winner|prize", re.I)):
        text = tag.get_text(strip=True)
        if text and len(text) > 2 and text not in project["prizes"]:
            project["prizes"].append(text)

    return project


def scrape_user_profile(profile_url: str, client: httpx.Client) -> dict:
    """Scrape a devpost user profile for contact info and social links."""
    info: dict = {"devpost_url": profile_url}
    try:
        resp = client.get(profile_url)
        resp.raise_for_status()
    except Exception as e:
        print(f"        Profile error {profile_url}: {e}")
        return info

    soup = BeautifulSoup(resp.text, "lxml")

    # User info section (most structured data)
    user_info = soup.find("div", id="portfolio-user-info") or soup.find("div", class_="user-info")
    if user_info:
        # Bio/tagline
        bio_el = user_info.find("p") or user_info.find(class_=re.compile(r"bio|tagline"))
        if bio_el:
            info["bio"] = bio_el.get_text(strip=True)

    # Social/contact links - but filter out devpost's own links
    devpost_socials = {"twitter.com/devpost", "linkedin.com/company/devpost", "facebook.com/devpost"}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        # Skip devpost's own social links
        if any(ds in href for ds in devpost_socials):
            continue
        if "github.com" in href and "/software/" not in href and "github" not in info:
            info["github"] = href
        elif "linkedin.com/in/" in href:
            info["linkedin"] = href
        elif ("twitter.com/" in href or "x.com/" in href) and "twitter" not in info:
            info["twitter"] = href
        elif "mailto:" in href:
            info["email"] = href.replace("mailto:", "")

    # Location - find the ss-location icon and get its parent's text
    loc_icon = soup.find("span", class_="ss-location")
    if loc_icon and loc_icon.parent:
        loc_text = loc_icon.parent.get_text(strip=True)
        if loc_text and len(loc_text) < 100:
            info["location"] = loc_text

    # Email from page text
    if "email" not in info:
        email_pattern = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
        for email in email_pattern.findall(soup.get_text()):
            if not any(x in email.lower() for x in ["devpost.com", "example.com", "sentry", "cloudfront"]):
                info["email"] = email
                break

    return info


def main():
    print("=== Devpost Hackathon Scraper ===\n")

    # Step 1: Get recent hackathons
    print("[1/4] Fetching recent hackathons...")
    hackathons = get_recent_hackathons(n_pages=5)
    print(f"Found {len(hackathons)} hackathons")

    # Prefer hackathons with winners announced, but include recent ones too
    with_winners = [h for h in hackathons if h["winners_announced"]]
    without_winners = [h for h in hackathons if not h["winners_announced"]]
    target = with_winners + without_winners[:max(0, 15 - len(with_winners))]
    print(f"Targeting {len(target)} hackathons ({len(with_winners)} with winners)\n")

    # Step 2: Get projects from each hackathon
    print("[2/4] Fetching project galleries...")
    all_project_urls: list[str] = []
    project_hackathon: dict[str, str] = {}

    for h in target:
        gallery = h.get("submission_gallery_url", "")
        if not gallery:
            continue
        print(f"  {h['title']}")
        urls = get_gallery_projects(gallery, max_pages=2)
        for u in urls:
            if u not in project_hackathon:
                project_hackathon[u] = h["title"]
                all_project_urls.append(u)
        time.sleep(0.3)

    print(f"\nTotal unique projects: {len(all_project_urls)}\n")

    # Step 3: Scrape each project
    print("[3/4] Scraping project details...")
    projects = []
    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=30) as client:
        for i, url in enumerate(all_project_urls):
            if i % 10 == 0:
                print(f"  Progress: {i}/{len(all_project_urls)}")
            project = scrape_project(url, client)
            if project:
                project["hackathon"] = project_hackathon.get(url, "")
                projects.append(project)
            time.sleep(0.3)

    print(f"\nScraped {len(projects)} projects\n")

    # Step 4: Scrape team member profiles
    print("[4/4] Scraping team member profiles...")
    all_profiles: dict[str, dict] = {}
    total_members = sum(len(p["team_members"]) for p in projects)
    scraped = 0

    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=30) as client:
        for project in projects:
            for member in project["team_members"]:
                profile_url = member["devpost_profile"]
                if profile_url not in all_profiles:
                    if scraped % 20 == 0:
                        print(f"  Progress: {scraped}/{total_members} unique profiles scraped")
                    profile_info = scrape_user_profile(profile_url, client)
                    all_profiles[profile_url] = profile_info
                    scraped += 1
                    time.sleep(0.3)
                member.update(all_profiles[profile_url])

    # Save results
    print("\n=== Saving results ===")

    # JSON
    json_path = Path("hackathon_winners.json")
    with open(json_path, "w") as f:
        json.dump(projects, f, indent=2)
    print(f"JSON: {json_path}")

    # Flat CSV (one row per team member)
    csv_path = Path("hackathon_winners.csv")
    rows = []
    for p in projects:
        if not p["team_members"]:
            # Still include projects with no detected members
            rows.append({
                "hackathon": p["hackathon"],
                "project_title": p["title"],
                "project_url": p["url"],
                "project_tagline": p["tagline"],
                "devpost_link": p["url"],
                "github_repo": p["links"].get("github", ""),
                "demo_url": p["links"].get("demo", ""),
                "prizes": "; ".join(p["prizes"]),
                "member_name": "",
                "devpost_profile": "",
                "member_github": "",
                "member_linkedin": "",
                "member_twitter": "",
                "member_email": "",
                "member_location": "",
            })
        for member in p["team_members"]:
            rows.append({
                "hackathon": p["hackathon"],
                "project_title": p["title"],
                "project_url": p["url"],
                "project_tagline": p["tagline"],
                "devpost_link": p["url"],
                "github_repo": p["links"].get("github", ""),
                "demo_url": p["links"].get("demo", ""),
                "prizes": "; ".join(p["prizes"]),
                "member_name": member.get("name", ""),
                "devpost_profile": member.get("devpost_url", member.get("devpost_profile", "")),
                "member_github": member.get("github", ""),
                "member_linkedin": member.get("linkedin", ""),
                "member_twitter": member.get("twitter", ""),
                "member_email": member.get("email", ""),
                "member_location": member.get("location", ""),
            })

    if rows:
        with open(csv_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"CSV: {csv_path} ({len(rows)} rows)")

    # Summary
    print(f"\n=== Summary ===")
    print(f"Hackathons: {len(target)}")
    print(f"Projects: {len(projects)}")
    print(f"Unique team members: {len(all_profiles)}")
    with_github = sum(1 for p in all_profiles.values() if p.get("github"))
    with_linkedin = sum(1 for p in all_profiles.values() if p.get("linkedin"))
    with_email = sum(1 for p in all_profiles.values() if p.get("email"))
    with_any = sum(1 for p in all_profiles.values() if any(p.get(k) for k in ["email", "github", "linkedin", "twitter"]))
    print(f"With GitHub: {with_github}")
    print(f"With LinkedIn: {with_linkedin}")
    print(f"With email: {with_email}")
    print(f"With any contact: {with_any}")


if __name__ == "__main__":
    main()
