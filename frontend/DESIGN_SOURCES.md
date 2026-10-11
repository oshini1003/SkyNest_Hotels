# SkyNest public-page design references

This update uses original React/CSS composition around the existing SkyNest API.
Design ideas: photographic introductions, destination cards, an easy-to-find stay
search, and generous spacing with serif headings.

Website references supplied by the team:
- https://www.shangri-la.com/colombo/shangrila/about/
- https://galadari.hotels-colombo.com/en/ (a hotel listing site)

No logos, text, prices, ratings, reviews or source code were copied from those websites.

## Photograph provenance

The original JPG images listed below were copied unchanged from the two reference ZIPs supplied by the team.
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

## Service-card images added 11 October 2026

The six WebP images below were created with the built-in image generator for this project. They are decorative, illustrative scenes, not verified photographs of SkyNest properties or guarantees of equipment, food or facilities. The catalogue and guest request pages retain their illustrative-image notice.

Each image is 1536 × 1024 pixels, encoded as WebP at quality 84 without resizing or cropping. Images are stored under `frontend/public/images/hotel/` and lazy-loaded from the same site. The existing spa and general dining JPGs remain unchanged.

`ServicePhoto.jsx` shares category matching between both pages. Unknown or demonstration services receive a neutral reception-bell image. If an image cannot load, the existing service icon is shown. The service API, names, prices and request workflow are unchanged.

### Generation prompts

**`service-airport-transfer.webp`**

Use case: photorealistic-natural. Asset type: decorative hotel service card photo. Primary request: An unbranded comfortable dark green-black premium hotel transfer car with a small elegant travel suitcase beside it at a tropical airport drop-off, palms and a softly blurred modern terminal in the background. No people. Style: natural editorial hotel photography, convincing real materials, understated upscale hospitality, warm cream and wood with muted dark green accents. Composition: landscape 3:2, approximately 1536x1024, centered important subject within the middle 65 percent so image-cover cropping remains clear. Soft natural light, realistic detail, no dramatic artificial effects. No text, logos, brands, signs or watermarks. This is a generic illustrative scene, not a depiction of any specific real property.

**`service-laundry.webp`**

Use case: photorealistic-natural. Asset type: decorative hotel service card photo. Primary request: Freshly folded crisp white hotel linens, a neatly pressed pale shirt and a wicker laundry basket on a warm wooden counter in a spotless upscale hotel laundry nook. Style: natural editorial hotel photography, convincing real materials, understated upscale hospitality, warm cream and wood with muted dark green accents. Composition: landscape 3:2, approximately 1536x1024, centered important subject within the middle 65 percent so image-cover cropping remains clear. Soft natural light, realistic detail, no dramatic artificial effects. No text, logos, brands, signs or watermarks. This is a generic illustrative scene, not a depiction of any specific real property.

**`service-minibar.webp`**

Use case: photorealistic-natural. Asset type: decorative hotel service card photo. Primary request: An elegant hotel minibar on a wood counter with unbranded glass drinks, sparkling water, two clear tumblers and small snack bowls, subtle deep green decor in the background. Style: natural editorial hotel photography, convincing real materials, understated upscale hospitality, warm cream and wood with muted dark green accents. Composition: landscape 3:2, approximately 1536x1024, centered important subject within the middle 65 percent so image-cover cropping remains clear. Soft natural light, realistic detail, no dramatic artificial effects. No text, logos, brands, signs or watermarks. This is a generic illustrative scene, not a depiction of any specific real property.

**`service-room-service.webp`**

Use case: photorealistic-natural. Asset type: decorative hotel service card photo. Primary request: A hotel room service meal tray holding a beautifully plated meal, bread, a white folded napkin and a polished covered silver cloche, set on a warm wood table beside a cream hotel bed. Style: natural editorial hotel photography, convincing real materials, understated upscale hospitality, warm cream and wood with muted dark green accents. Composition: landscape 3:2, approximately 1536x1024, centered important subject within the middle 65 percent so image-cover cropping remains clear. Soft natural light, realistic detail, no dramatic artificial effects. No text, logos, brands, signs or watermarks. This is a generic illustrative scene, not a depiction of any specific real property.

**`service-breakfast.webp`**

Use case: photorealistic-natural. Asset type: decorative hotel service card photo. Primary request: An actual elegant hotel breakfast buffet spread with fresh sliced tropical fruit, pastries, bread, juice carafes and white ceramic platters on a warm wood counter, natural morning light. Clearly a hotel buffet, not a street restaurant. Style: natural editorial hotel photography, convincing real materials, understated upscale hospitality, warm cream and wood with muted dark green accents. Composition: landscape 3:2, approximately 1536x1024, centered important subject within the middle 65 percent so image-cover cropping remains clear. Soft natural light, realistic detail, no dramatic artificial effects. No text, logos, brands, signs or watermarks. This is a generic illustrative scene, not a depiction of any specific real property.

**`service-hospitality.webp`**

Use case: photorealistic-natural. Asset type: decorative hotel service card photo. Primary request: A polished brass hotel reception bell on a rich wooden reception counter, softly blurred welcoming hotel lobby with cream upholstery and subtle dark green tropical plants behind it. No people. Style: natural editorial hotel photography, convincing real materials, understated upscale hospitality, warm cream and wood with muted dark green accents. Composition: landscape 3:2, approximately 1536x1024, centered important subject within the middle 65 percent so image-cover cropping remains clear. Soft natural light, realistic detail, no dramatic artificial effects. No text, logos, brands, signs or watermarks. This is a generic illustrative scene, not a depiction of any specific real property.
