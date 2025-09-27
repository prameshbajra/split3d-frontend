import { AfterViewInit, Component, ElementRef, inject, OnDestroy, ViewChild } from '@angular/core';
import * as THREE from 'three';
import { CommonModule } from '@angular/common';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ModelLoaderService } from '../../services/model-loader.service';
import {
  addDefaultLighting,
  disposeObject,
  fitCameraToObject,
} from '../../../../shared/utils/three-utils';

@Component({
  selector: 'app-model-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './model-viewer.component.html',
  styleUrl: './model-viewer.component.css',
})
export class ModelViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('viewerContainer', { static: true })
  private viewerContainer!: ElementRef<HTMLDivElement>;

  errorMessage: string | null = null;
  loadedFileName: string | null = null;
  dimensions: { x: number; y: number; z: number } | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationFrameId: number | null = null;
  private currentModel: THREE.Object3D | null = null;
  private resizeObserver?: ResizeObserver;
  private readonly workspaceGroup = new THREE.Group();
  private readonly workspaceSize = 400;
  readonly workspaceGridUnit = 10;
  private boundingBoxHelper: THREE.Box3Helper | null = null;

  private readonly modelLoader = inject(ModelLoaderService);

  ngAfterViewInit(): void {
    this.initScene();
    this.startRenderingLoop();
    this.observeContainerSize();
    window.addEventListener('resize', this.handleResize);
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.disposeCurrentModel();

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }

  async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    this.errorMessage = null;
    this.loadedFileName = file.name;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const extension = file.name.split('.').pop()?.toLowerCase();

      if (!extension) {
        throw new Error('Unable to determine the file type. Please upload an STL or 3MF file.');
      }

      const model = this.modelLoader.loadModel(arrayBuffer, extension);
      this.attachModel(model);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load the selected file.';
      this.errorMessage = message;
      this.loadedFileName = null;
      this.disposeCurrentModel();
    }

    input.value = '';
  }

  private initScene(): void {
    const container = this.viewerContainer.nativeElement;

    const width = container.clientWidth || container.offsetWidth || 640;
    const height = container.clientHeight || container.offsetHeight || 480;

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10_000);
    this.camera.position.set(0, 120, 240);

    this.scene.background = new THREE.Color(0x111827);

    addDefaultLighting(this.scene);
    this.scene.add(this.workspaceGroup);
    this.buildWorkspace();

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 2000;

    this.updateRendererSize();
  }

  private buildWorkspace(): void {
    this.workspaceGroup.clear();

    const platformThickness = 6;
    const halfThickness = platformThickness / 2;

    const platformGeometry = new THREE.BoxGeometry(
      this.workspaceSize,
      platformThickness,
      this.workspaceSize,
    );
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.1,
      roughness: 0.85,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.receiveShadow = true;
    platform.castShadow = false;
    platform.position.set(0, -halfThickness, 0);
    this.workspaceGroup.add(platform);

    const gridDivisions = Math.max(Math.round(this.workspaceSize / this.workspaceGridUnit), 1);
    const gridHelper = new THREE.GridHelper(
      this.workspaceSize,
      gridDivisions,
      0x60a5fa,
      0x334155,
    );
    gridHelper.position.set(0, 0.05, 0);
    this.workspaceGroup.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(this.workspaceSize / 2);
    // Swap axes so blue (Z) arrow points upward while keeping default colors.
    const swapMatrix = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    );
    axesHelper.geometry.applyMatrix4(swapMatrix);
    axesHelper.position.set(0, 0.05, 0);
    this.workspaceGroup.add(axesHelper);

    const edgeGeometry = new THREE.EdgesGeometry(platformGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x475569 });
    const platformEdges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    platformEdges.position.copy(platform.position);
    this.workspaceGroup.add(platformEdges);
  }

  private observeContainerSize(): void {
    if (typeof ResizeObserver === 'undefined') {
      this.handleResize();
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.updateRendererSize());
    this.resizeObserver.observe(this.viewerContainer.nativeElement);
  }

  private updateRendererSize(): void {
    if (!this.renderer) {
      return;
    }

    const container = this.viewerContainer.nativeElement;
    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private attachModel(model: THREE.Object3D): void {
    this.disposeCurrentModel();

    const normalizedBox = this.centerModel(model);
    this.scene.add(model);
    this.currentModel = model;
    this.dimensions = normalizedBox.isEmpty() ? null : this.extractDimensions(normalizedBox);
    this.updateBoundingBoxHelper(normalizedBox);

    fitCameraToObject(this.camera, model, this.controls);
  }

  private disposeCurrentModel(): void {
    if (!this.currentModel) {
      return;
    }

    this.scene.remove(this.currentModel);
    disposeObject(this.currentModel);

    this.currentModel = null;
    this.dimensions = null;
    this.removeBoundingBoxHelper();
  }

  private centerModel(model: THREE.Object3D): THREE.Box3 {
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        const geometry = mesh.geometry as THREE.BufferGeometry;
        if (geometry.boundingBox === null) {
          geometry.computeBoundingBox();
        }
      }
    });

    // Rotate the model so its original Y-up content lies flat on the build plane.
    model.rotation.set(0, 0, 0);
    model.rotateX(Math.PI / 2);
    model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(model);

    if (box.isEmpty()) {
      model.position.set(0, 0, 0);
      model.updateMatrixWorld(true);
      return box;
    }

    const center = box.getCenter(new THREE.Vector3());
    const minY = box.min.y;

    model.position.sub(center);
    model.position.y -= minY - center.y;
    model.updateMatrixWorld(true);

    return new THREE.Box3().setFromObject(model);
  }

  private extractDimensions(box: THREE.Box3): { x: number; y: number; z: number } {
    const size = box.getSize(new THREE.Vector3());
    return {
      x: size.x,
      y: size.y,
      z: size.z,
    };
  }

  private updateBoundingBoxHelper(box: THREE.Box3): void {
    this.removeBoundingBoxHelper();

    if (box.isEmpty()) {
      return;
    }

    const helper = new THREE.Box3Helper(box, 0x93c5fd);
    this.scene.add(helper);
    this.boundingBoxHelper = helper;
  }

  private removeBoundingBoxHelper(): void {
    if (!this.boundingBoxHelper) {
      return;
    }

    this.scene.remove(this.boundingBoxHelper);
    this.boundingBoxHelper.geometry.dispose();

    const material = this.boundingBoxHelper.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material.dispose();
    }
    this.boundingBoxHelper = null;
  }

  private startRenderingLoop(): void {
    if (!this.renderer) {
      return;
    }

    const render = () => {
      this.controls.update();
      this.renderer!.render(this.scene, this.camera);
      this.animationFrameId = requestAnimationFrame(render);
    };

    render();
  }

  private handleResize = (): void => {
    if (!this.renderer) {
      return;
    }

    this.updateRendererSize();
  };
}
