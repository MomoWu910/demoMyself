import { PLACES, STARS, type Point, type PlaceId } from './world';

const base = `<rect x="-50" y="-50" width="100" height="100" rx="12" fill="#dbead2"/>
<path d="M-45-39Q0-54 45-39V40Q0 54-45 40Z" fill="#c3dcba"/>
<g fill="none" stroke="#fff4dc" stroke-width="7" stroke-linejoin="round"><path d="M0 43V-24M-38 0H38M-28-10V29H28V-10ZM-28-10H28"/></g>
<circle r="9.5" fill="#f5e7ca"/><circle r="4.5" fill="#8acbd0" stroke="#fff9ed" stroke-width="1.2"/>
<rect x="-10" y="-39" width="20" height="16" rx="3" fill="#b5a0d0" stroke="#fffaf1" stroke-width="1"/>
<circle cx="-28" cy="-17" r="8" fill="#e7b2c4" stroke="#fffaf1" stroke-width="1"/><path d="M-34-17h12m-6-6v12m-4-10l8 8m-8 0l8-8" stroke="#fff4e9" stroke-width=".8"/>
<circle cx="28" cy="-14" r="8" fill="#e9c98e" stroke="#fffaf1" stroke-width="1"/><circle cx="28" cy="-14" r="4" fill="#eab0b9"/>
<rect x="22" y="18" width="12" height="8" rx="2" fill="#8dc7be" stroke="#fffaf1"/>
<path d="M-7 37h14" stroke="#80bfa8" stroke-width="3"/>
<g fill="#9fc89c"><circle cx="-17" cy="14" r="3"/><circle cx="16" cy="16" r="3"/><circle cx="-17" cy="-20" r="3"/><circle cx="16" cy="-27" r="3"/><circle cx="-38" cy="23" r="3"/><circle cx="-19" cy="37" r="3"/><circle cx="40" cy="12" r="3"/><circle cx="36" cy="35" r="3"/></g>`;
export function createMaps(onTravel: (id: PlaceId) => void): { update: (p: Point, yaw: number, stars: Set<number>) => void } {
    const mini = document.getElementById('mini-svg')!;
    const full = document.getElementById('full-map')!;
    const destinations = document.getElementById('destinations')!;
    for (const svg of [mini, full]) {
        svg.innerHTML = base + STARS.map((p, i) => `<text class="map-star" data-star="${i}" x="${p.x}" y="${p.z + 1.2}" text-anchor="middle" font-size="4" fill="#cda151">✦</text>`).join('')
            + `<g class="map-player"><circle r="2.6" fill="#fff"/><circle r="1.7" fill="#db7f99"/><path class="map-heading-arrow" d="M0-5l-1.5 2.3h3Z" fill="#db7f99"/></g>`;
    }
    // Destination labels are keyboard-operable buttons in SVG; the list is an alternative.
    for (const p of PLACES) {
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        marker.classList.add('map-place'); marker.setAttribute('role', 'button'); marker.setAttribute('tabindex', '0'); marker.setAttribute('aria-label', `快速旅行至${p.name}`);
        marker.innerHTML = `<circle cx="${p.position.x}" cy="${p.position.z}" r="4" fill="${p.color}" stroke="#fff" stroke-width=".7"/><text x="${p.position.x}" y="${p.position.z + 1.6}" text-anchor="middle" fill="white" font-size="4.5">${p.icon}</text><text x="${p.position.x}" y="${p.position.z + 7}" text-anchor="middle" fill="#526b64" font-size="2.6" font-family="system-ui" paint-order="stroke" stroke="#f3f4df" stroke-width="1">${p.name}</text>`;
        marker.addEventListener('click', () => onTravel(p.id));
        marker.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTravel(p.id); } });
        full.insertBefore(marker, full.querySelector('.map-player'));
        const button = document.createElement('button'); button.className = 'destination'; button.setAttribute('aria-label', `前往${p.name}`);
        button.innerHTML = `<span class="destination-icon" style="color:${p.color}">${p.icon}</span><span><strong>${p.name}</strong><small>${p.en}</small></span><span>↗</span>`;
        button.addEventListener('click', () => onTravel(p.id)); destinations.appendChild(button);
    }
    const playerMarkers = [mini.querySelector('.map-player')!, full.querySelector('.map-player')!];
    const arrows = [mini.querySelector('.map-heading-arrow')!, full.querySelector('.map-heading-arrow')!];
    return { update(p, yaw, stars) {
        playerMarkers.forEach((m) => m.setAttribute('transform', `translate(${p.x} ${p.z})`));
        arrows.forEach((m) => m.setAttribute('transform', `rotate(${-yaw * 180 / Math.PI})`));
        for (const svg of [mini, full]) svg.querySelectorAll<SVGElement>('.map-star').forEach((s) => { s.style.display = stars.has(Number(s.dataset.star)) ? 'none' : ''; });
    } };
}
