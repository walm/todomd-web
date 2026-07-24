// Injected into the page while recording: agent-browser's video does not draw
// the mouse pointer, so the page draws one itself. Real input events reach the
// document, so the cursor follows every move, press and drag for free —
// nothing in the driver has to keep it in sync.
;(() => {
  const arrow =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22">' +
    '<path d="M5 2.5 L5 19 L9.2 15.2 L11.8 21 L14.6 19.7 L12 14 L18 13.6 Z" ' +
    'fill="#fff" stroke="rgba(0,0,0,.65)" stroke-width="1.2" stroke-linejoin="round"/></svg>'

  document.getElementById('__demo_cursor')?.remove()
  const el = document.createElement('div')
  el.id = '__demo_cursor'
  el.style.cssText =
    'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;' +
    'pointer-events:none;background-repeat:no-repeat;' +
    'transition:transform 90ms linear;' +
    'filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));' +
    'background-image:url("data:image/svg+xml,' + encodeURIComponent(arrow) + '")'
  document.body.appendChild(el)

  let pressed = false
  const place = (event) => {
    el.style.transform =
      'translate(' + (event.clientX - 2) + 'px,' + (event.clientY - 2) + 'px) ' +
      'scale(' + (pressed ? 0.82 : 1) + ')'
  }
  // Capture phase: a drag library that stops propagation must not blind us.
  addEventListener('pointermove', place, true)
  addEventListener('pointerdown', (e) => ((pressed = true), place(e)), true)
  addEventListener('pointerup', (e) => ((pressed = false), place(e)), true)
})()
