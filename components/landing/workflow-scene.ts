import * as THREE from 'three'

/** Decorative card surfaces only; all information stays in the server-rendered HTML. */
export function createWorkflowScene(
  mount: HTMLDivElement,
  diagram: HTMLElement,
): () => void {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.setAttribute('aria-hidden', 'true')

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 50)
  camera.position.z = 15
  const cards = new THREE.Group()
  const entranceTilt = Math.PI / 90
  cards.rotation.x = entranceTilt
  scene.add(cards)
  scene.add(new THREE.AmbientLight(0xffffff, 2.4))
  const light = new THREE.DirectionalLight(0xffffff, 2)
  light.position.set(-4, 7, 10)
  scene.add(light)

  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const paper = new THREE.MeshStandardMaterial({
    color: 0xfaf9f5,
    roughness: 1,
    metalness: 0,
  })
  const clay = new THREE.MeshBasicMaterial({ color: 0xa95134 })
  const ink = new THREE.LineBasicMaterial({ color: 0xb9b1a1 })
  materials.push(paper, clay, ink)

  // Percent positions mirror the four HTML panels; camera coordinates span 10 × 10.
  const surfaces = [
    { x: 50, y: 24, w: 65, h: 28 },
    { x: 25, y: 56.5, w: 42, h: 21 },
    { x: 78, y: 55, w: 34, h: 20 },
    { x: 62.5, y: 85, w: 65, h: 20 },
  ]
  surfaces.forEach(({ x, y, w, h }, index) => {
    const geometry = new THREE.BoxGeometry(w / 10, h / 10, 0.1)
    const edges = new THREE.EdgesGeometry(geometry)
    geometries.push(geometry, edges)
    const card = new THREE.Mesh(geometry, paper)
    card.position.set((x - 50) / 10, (50 - y) / 10, index === 0 ? 0.15 : 0)
    card.add(new THREE.LineSegments(edges, ink))
    cards.add(card)
    if (index === 0) {
      const stripeGeometry = new THREE.BoxGeometry(w / 10, 0.045, 0.012)
      geometries.push(stripeGeometry)
      const stripe = new THREE.Mesh(stripeGeometry, clay)
      stripe.position.set(0, h / 20 - 0.0225, 0.06)
      card.add(stripe)
    }
  })

  let frame = 0
  let stopped = false
  let ready = false
  const start = performance.now()
  let targetX = 0
  let targetY = 0

  function draw(now: number) {
    frame = 0
    if (stopped) return
    const intro = Math.min((now - start) / 600, 1)
    const ease = 1 - Math.pow(1 - intro, 3)
    const rotationX = targetX + entranceTilt * (1 - ease)
    cards.rotation.x += (rotationX - cards.rotation.x) * 0.14
    cards.rotation.y += (targetY - cards.rotation.y) * 0.14
    try {
      renderer.render(scene, camera)
    } catch {
      cleanup()
      return
    }
    if (!ready) {
      ready = true
      diagram.dataset.scene = 'ready'
    }
    if (
      intro < 1 ||
      Math.abs(targetX - cards.rotation.x) > 0.0001 ||
      Math.abs(targetY - cards.rotation.y) > 0.0001
    ) {
      frame = requestAnimationFrame(draw)
    }
  }

  function requestDraw() {
    if (!frame && !stopped) frame = requestAnimationFrame(draw)
  }

  function resize() {
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    requestDraw()
  }

  function pointer(event: PointerEvent) {
    const rect = diagram.getBoundingClientRect()
    const x = Math.max(
      -1,
      Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2),
    )
    const y = Math.max(
      -1,
      Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2),
    )
    targetX = (-y * Math.PI) / 60
    targetY = (x * Math.PI) / 60
    requestDraw()
  }

  function reset() {
    targetX = targetY = 0
    requestDraw()
  }

  function contextLost(event: Event) {
    event.preventDefault()
    cleanup()
  }

  const observer = new ResizeObserver(resize)
  function cleanup() {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    observer.disconnect()
    diagram.removeEventListener('pointermove', pointer)
    diagram.removeEventListener('pointerleave', reset)
    renderer.domElement.removeEventListener('webglcontextlost', contextLost)
    delete diagram.dataset.scene
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
    renderer.dispose()
    renderer.forceContextLoss()
    renderer.domElement.remove()
  }

  try {
    mount.appendChild(renderer.domElement)
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    diagram.addEventListener('pointermove', pointer)
    diagram.addEventListener('pointerleave', reset)
    observer.observe(mount)
    resize()
  } catch (error) {
    cleanup()
    throw error
  }
  return cleanup
}
