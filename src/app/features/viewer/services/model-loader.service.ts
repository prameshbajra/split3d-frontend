import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

@Injectable({ providedIn: 'root' })
export class ModelLoaderService {
  private readonly stlLoader = new STLLoader();
  private readonly threeMfLoader = new ThreeMFLoader();

  loadModel(data: ArrayBuffer, extension: string): THREE.Object3D {
    switch (extension) {
      case 'stl':
        return this.loadStl(data);
      case '3mf':
        return this.load3mf(data);
      default:
        throw new Error('Unsupported file type. Please upload an STL or 3MF file.');
    }
  }

  private loadStl(data: ArrayBuffer): THREE.Object3D {
    const geometry = this.stlLoader.parse(data);
    const material = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      metalness: 0.1,
      roughness: 0.6,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  private load3mf(data: ArrayBuffer): THREE.Object3D {
    const object = this.threeMfLoader.parse(data);

    object.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const material = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (material) {
          material.metalness = 0.1;
          material.roughness = 0.7;
        }
      }
    });

    return object;
  }
}
