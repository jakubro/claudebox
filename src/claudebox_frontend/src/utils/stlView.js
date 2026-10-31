/** Camera framing for a model block: the fitted opening view and the zoom buttons' dolly. */

import { STL_MAX_DISTANCE_FACTOR, STL_MIN_DISTANCE_FACTOR } from '../config/thresholds'

const FIT_MARGIN = 1.3

/**
 * Centre `geometry` on the origin, place `camera` so its bounding sphere fills the view, and
 * bound the controls' distance to it; returns the sphere's radius.
 */
export function fitModel(geometry, camera, controls) {
  geometry.computeBoundingSphere()
  const { center, radius } = geometry.boundingSphere
  geometry.translate(-center.x, -center.y, -center.z)
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * FIT_MARGIN
  camera.position.set(distance * 0.6, distance * 0.5, distance * 0.62).setLength(distance)
  camera.near = distance / 100
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.minDistance = radius * STL_MIN_DISTANCE_FACTOR
  controls.maxDistance = distance * STL_MAX_DISTANCE_FACTOR
  controls.update()
  controls.saveState()
  return radius
}

/** Move the camera along its view axis by `factor`, within the controls' distance bounds. */
export function dolly(camera, controls, factor) {
  const offset = camera.position.clone().sub(controls.target)
  const length = Math.min(
    controls.maxDistance,
    Math.max(controls.minDistance, offset.length() * factor),
  )
  camera.position.copy(controls.target).add(offset.setLength(length))
  controls.update()
}
