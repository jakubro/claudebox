/** The three.js scene of one model block: mesh, lights, camera, orbit controls, on-demand drawing. */

import { dolly, fitModel } from './stlView'

/** Build the scene into `host`; returns the teardown releasing every GPU resource and the context. */
export function buildScene({ THREE, OrbitControls }, geometry, host, viewRef) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  const styles = getComputedStyle(host)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(styles.getPropertyValue('--bg-secondary').trim() || '#212122')

  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({
    color: 0xb8c0cc,
    metalness: 0.1,
    roughness: 0.7,
  })
  scene.add(new THREE.Mesh(geometry, material))
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2))

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000)
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5)
  keyLight.position.set(1, 1, 2)
  camera.add(keyLight)
  scene.add(camera)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.screenSpacePanning = true
  // Zoom is armed only while a finger is down: a pinch zooms the model, a wheel scrolls the chat.
  const touches = new Set()
  const onPointerDown = event => {
    if (event.pointerType === 'touch') {
      touches.add(event.pointerId)
    }
    controls.enableZoom = touches.size > 0
  }
  const onPointerUp = event => {
    touches.delete(event.pointerId)
    controls.enableZoom = touches.size > 0
  }
  controls.enableZoom = false
  host.addEventListener('pointerdown', onPointerDown, { capture: true })
  host.addEventListener('pointerup', onPointerUp, { capture: true })
  host.addEventListener('pointercancel', onPointerUp, { capture: true })
  fitModel(geometry, camera, controls)

  const render = () => renderer.render(scene, camera)
  const resize = () => {
    const width = host.clientWidth
    const height = host.clientHeight
    renderer.setSize(width, height)
    camera.aspect = width / height || 1
    camera.updateProjectionMatrix()
    render()
  }
  controls.addEventListener('change', render)
  host.append(renderer.domElement)
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  viewRef.current = {
    zoom: factor => dolly(camera, controls, factor),
    reset: () => controls.reset(),
  }

  return () => {
    host.removeEventListener('pointerdown', onPointerDown, { capture: true })
    host.removeEventListener('pointerup', onPointerUp, { capture: true })
    host.removeEventListener('pointercancel', onPointerUp, { capture: true })
    observer.disconnect()
    controls.removeEventListener('change', render)
    controls.dispose()
    geometry.dispose()
    material.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
    renderer.domElement.remove()
  }
}
