import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function addDefaultLighting(scene: THREE.Scene): void {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(200, 500, 300);
  directionalLight.castShadow = true;

  scene.add(ambientLight);
  scene.add(directionalLight);
}

export function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  controls?: OrbitControls,
  paddingFactor = 1.8,
): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fitDistance = maxDim * paddingFactor;

  camera.position.copy(center);
  camera.position.x += fitDistance;
  camera.position.y += fitDistance;
  camera.position.z += fitDistance;
  camera.near = Math.max(fitDistance / 100, 0.1);
  camera.far = fitDistance * 100;
  camera.updateProjectionMatrix();

  controls?.target.copy(center);
  controls?.update();
}

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material: THREE.Material) => material.dispose());
      } else {
        mesh.material?.dispose();
      }
    }

    const lineSegments = child as THREE.LineSegments;
    if (lineSegments.isLineSegments) {
      lineSegments.geometry.dispose();
      if (Array.isArray(lineSegments.material)) {
        lineSegments.material.forEach((material: THREE.Material) => material.dispose());
      } else {
        lineSegments.material?.dispose();
      }
    }

    const sprite = child as THREE.Sprite;
    if (sprite.isSprite) {
      const material = sprite.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    }
  });
}
