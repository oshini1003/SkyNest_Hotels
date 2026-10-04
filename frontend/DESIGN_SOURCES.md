# SkyNest public-page design references

This update uses original React/CSS composition around the existing SkyNest API.
Design ideas: photographic introductions, destination cards, an easy-to-find stay
search, and generous spacing with serif headings.

Website references supplied by the team:
- https://www.shangri-la.com/colombo/shangrila/about/
- https://galadari.hotels-colombo.com/en/ (a hotel listing site)

No logos, text, prices, ratings, reviews or source code were copied from those websites.

## Photograph provenance

Images were copied unchanged from the two reference ZIPs supplied by the team.
They are illustrative coursework images, not verified photographs of SkyNest rooms
or evidence that a pictured facility exists at a branch. The interface labels them
as illustrative. The supplied archives do not establish image ownership or licensing;
verify permission or replace them with owned/licensed photographs before public use.

| Current file under `public/images/hotel/` | Supplied archive and original path |
|---|---|
| `hero.jpg` | `SkyNest_Hotels-main_3.zip` → `frontend/src/assets/images/external/home/hero-background.jpg` |
| `room-standard.jpg` | `SkyNest_Hotels-main_3.zip` → `frontend/src/assets/images/external/home/standard-room.jpg` |
| `room-deluxe.jpg` | `SkyNest_Hotels-main_3.zip` → `frontend/src/assets/images/external/home/deluxe-suite.jpg` |
| `room-family.jpg` | `SkyNest_Hotels-main_3.zip` → `frontend/src/assets/images/external/home/family-room.jpg` |
| `service-dining.jpg` | `SkyNest_Hotels-main_3.zip` → `frontend/src/assets/images/external/home/fine-dining.jpg` |
| `service-spa.jpg` | `SkyNest_Hotels-main_3.zip` → `frontend/src/assets/images/external/home/luxury-spa.jpg` |
| `branch-colombo.jpg` | `DatabaseProject_skyNest-main.zip` → `frontend/src/Guest/public/images/urban-branch.jpg` |
| `branch-kandy.jpg` | `DatabaseProject_skyNest-main.zip` → `frontend/src/Guest/public/images/hills-branch.jpg` |
| `branch-galle.jpg` | `DatabaseProject_skyNest-main.zip` → `frontend/src/Guest/public/images/coastal-branch.jpg` |

## Data and functionality

Branches and their contact details, room availability and rates, and the service
catalogue come from the existing API. Home destination descriptions are editorial
city introductions, not claims about hotel facilities. Search from Home or a branch
only prefills the room-search form; the guest must search for availability before
selecting a room. No availability, reservation, discount or payment is fabricated.

GuestLogin, GuestRegister and GuestProfile are assigned to Lakshan and are outside
this update. Shared authentication, staff workflows and backend code are preserved.
