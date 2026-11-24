// Iceberg category icons. One system for every category, so nothing depends on platform emoji:
//   32×32 canvas, 2.25px rounded strokes in the text colour (currentColor), one soft tint fill (--icon-tint),
//   crisp vector edges at any size, no gradients, no gloss. Add a category by adding one entry with the same rules.
(function () {
  "use strict";
  const S = 'fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"';
  const TINT = 'fill="var(--icon-tint, rgba(143,208,245,.22))" stroke="none"';
  const ICONS = {
    // A wheel: tyre, rim, five spokes, hub.
    wheels: `<circle cx="16" cy="16" r="12.5" ${TINT}/><circle cx="16" cy="16" r="12.5" ${S}/><circle cx="16" cy="16" r="8.5" ${S}/>
      <circle cx="16" cy="16" r="2.4" fill="currentColor"/>
      <path ${S} d="M16 13.6V7.5M18.3 15.3l5.8-1.9M17.4 18l3.6 4.9M14.6 18l-3.6 4.9M13.7 15.3l-5.8-1.9"/>`,
    // A frying pan, seen from above.
    kitchen: `<circle cx="13" cy="19" r="9.8" ${TINT}/><circle cx="13" cy="19" r="9.8" ${S}/><circle cx="13" cy="19" r="5.6" ${S} opacity=".5"/>
      <rect x="21.2" y="8.6" width="10" height="4" rx="2" transform="rotate(-45 21.2 10.6)" ${S}/>`,
    // A paw print.
    animals: `<path ${TINT} d="M16 15.2c-3.8 0-7.4 4.6-7.4 7.8 0 2.3 1.8 3.4 3.6 3.4 1.6 0 2.4-.9 3.8-.9s2.2.9 3.8.9c1.8 0 3.6-1.1 3.6-3.4 0-3.2-3.6-7.8-7.4-7.8z"/>
      <path ${S} d="M16 15.2c-3.8 0-7.4 4.6-7.4 7.8 0 2.3 1.8 3.4 3.6 3.4 1.6 0 2.4-.9 3.8-.9s2.2.9 3.8.9c1.8 0 3.6-1.1 3.6-3.4 0-3.2-3.6-7.8-7.4-7.8z"/>
      <ellipse cx="7" cy="13.6" rx="2.3" ry="2.9" ${S}/><ellipse cx="12.3" cy="7.8" rx="2.4" ry="3" ${S}/>
      <ellipse cx="19.7" cy="7.8" rx="2.4" ry="3" ${S}/><ellipse cx="25" cy="13.6" rx="2.3" ry="2.9" ${S}/>`,
    // An apple with a leaf.
    fruits: `<path ${TINT} d="M16 10.4c-2-1.7-5.6-2-7.9.2-2.9 2.8-2.3 8.3.2 12.2 1.8 2.8 3.9 4.6 5.8 4.1.8-.2 1.3-.6 1.9-.6s1.1.4 1.9.6c1.9.5 4-1.3 5.8-4.1 2.5-3.9 3.1-9.4.2-12.2-2.3-2.2-5.9-1.9-7.9-.2z"/>
      <path ${S} d="M16 10.4c-2-1.7-5.6-2-7.9.2-2.9 2.8-2.3 8.3.2 12.2 1.8 2.8 3.9 4.6 5.8 4.1.8-.2 1.3-.6 1.9-.6s1.1.4 1.9.6c1.9.5 4-1.3 5.8-4.1 2.5-3.9 3.1-9.4.2-12.2-2.3-2.2-5.9-1.9-7.9-.2z"/>
      <path ${S} d="M16 10.4c0-2.4.6-4.6 2-6.2"/><path ${S} d="M18.6 7.6c1.6-2.6 4.4-3 6.2-2.5-.4 2.4-2.8 4.1-6.2 2.5z"/>`,
    // Two letter tiles: S and N.
    sn: `<rect x="3.5" y="7.5" width="12" height="17" rx="2.5" ${TINT}/><rect x="3.5" y="7.5" width="12" height="17" rx="2.5" ${S}/>
      <rect x="16.5" y="7.5" width="12" height="17" rx="2.5" ${S}/>
      <path ${S} d="M12.2 12.4c-.5-1-1.5-1.5-2.7-1.5-1.5 0-2.6.9-2.6 2.1 0 2.9 5.5 1.6 5.5 4.8 0 1.3-1.2 2.3-2.8 2.3-1.3 0-2.4-.6-2.9-1.7"/>
      <path ${S} d="M19.8 20.6v-9.6l5.4 9.6v-9.6"/>`,
    // Fallback for any future category without its own icon: a small iceberg.
    default: `<path ${TINT} d="M4 21 11 8l4 5 3-3 10 11z"/><path ${S} d="M4 21 11 8l4 5 3-3 10 11z"/><path ${S} d="M3 24.5h26" opacity=".55"/>`,
  };
  function svg(key, label) {
    const body = ICONS[key] || ICONS.default;
    return `<svg class="cat-svg" viewBox="0 0 32 32" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} focusable="false">${body}</svg>`;
  }
  // Put a category icon into an element (replaces its contents).
  function put(el, key) { if (el) el.innerHTML = svg(key); }
  window.IcebergIcons = { svg, put, keys: Object.keys(ICONS) };
})();
