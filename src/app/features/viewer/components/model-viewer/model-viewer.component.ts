import { AfterViewInit, Component, ElementRef, inject, OnDestroy, ViewChild } from '@angular/core';
import * as THREE from 'three';
import { CommonModule } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators, FormControl } from '@angular/forms';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ModelLoaderService } from '../../services/model-loader.service';
import {
  addDefaultLighting,
  disposeObject,
  fitCameraToObject,
} from '../../../../shared/utils/three-utils';
import { SplitSidebarComponent, DivisionFormGroup } from '../split-sidebar/split-sidebar.component';

type DivisionCounts = { x: number; y: number; z: number };

@Component({
  selector: 'app-model-viewer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SplitSidebarComponent],
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
  private readonly defaultWorkspaceSize = 400;
  private readonly workspacePaddingRatio = 0.2;
  private readonly minWorkspacePadding = 40;
  private workspaceSize = this.defaultWorkspaceSize;
  readonly workspaceGridUnit = 10;
  private boundingBoxHelper: THREE.Box3Helper | null = null;
  private readonly splitPlanesGroup = new THREE.Group();
  private currentBoundingBox: THREE.Box3 | null = null;
  private lastAppliedDivisions: DivisionCounts | null = null;

  readonly maxDivisionSegments = 12;
  private readonly defaultDivisions: DivisionCounts = { x: 1, y: 1, z: 1 };
  private readonly formBuilder = inject(NonNullableFormBuilder);
  readonly divisionForm: DivisionFormGroup = this.formBuilder.group({
    x: this.createDivisionControl(),
    y: this.createDivisionControl(),
    z: this.createDivisionControl(),
  });

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

    this.clearSplitPlanes();

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

  get hasModelLoaded(): boolean {
    return this.currentModel !== null;
  }

  get hasActiveSplits(): boolean {
    return this.splitPlanesGroup.children.length > 0;
  }

  applyDivisionSettings(): void {
    if (!this.hasModelLoaded) {
      return;
    }

    if (this.divisionForm.invalid) {
      this.divisionForm.markAllAsTouched();
      return;
    }

    const normalized = this.normalizeCounts(this.divisionForm.getRawValue());
    this.divisionForm.setValue(normalized, { emitEvent: false });
    this.lastAppliedDivisions = normalized;
    this.renderSplitPlanes(normalized);
  }

  clearDivisionPlanes(): void {
    this.clearSplitPlanes();
    this.lastAppliedDivisions = null;
    this.divisionForm.setValue(this.defaultDivisions, { emitEvent: false });
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
    this.scene.add(this.splitPlanesGroup);
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
    this.workspaceGroup.children.forEach((child) => disposeObject(child));
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
    this.addAxisLabels(axesHelper);
    this.workspaceGroup.add(axesHelper);

    const edgeGeometry = new THREE.EdgesGeometry(platformGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x475569 });
    const platformEdges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    platformEdges.position.copy(platform.position);
    this.workspaceGroup.add(platformEdges);
  }

  private updateWorkspaceSize(box: THREE.Box3): void {
    if (box.isEmpty()) {
      this.resetWorkspaceSize();
      return;
    }

    const size = box.getSize(new THREE.Vector3());
    const longestDimension = Math.max(size.x, size.y, size.z);
    const padding = Math.max(this.minWorkspacePadding, longestDimension * this.workspacePaddingRatio);
    const desiredSize = longestDimension + padding;
    const quantizedSize =
      Math.ceil(desiredSize / this.workspaceGridUnit) * this.workspaceGridUnit;
    const nextSize = Math.max(this.defaultWorkspaceSize, quantizedSize);

    if (Math.abs(nextSize - this.workspaceSize) < 0.5) {
      return;
    }

    this.workspaceSize = nextSize;
    this.buildWorkspace();
  }

  private resetWorkspaceSize(): void {
    if (this.workspaceSize === this.defaultWorkspaceSize) {
      return;
    }

    this.workspaceSize = this.defaultWorkspaceSize;
    this.buildWorkspace();
  }

  private addAxisLabels(axesHelper: THREE.AxesHelper): void {
    const halfSize = this.workspaceSize / 2;
    const offset = Math.max(this.workspaceGridUnit * 1.5, 14);
    const labelScale = Math.min(Math.max(this.workspaceSize * 0.05, 18), 48);

    const xLabel = this.createAxisLabel('X', '#f87171', labelScale);
    xLabel.position.set(halfSize + offset, 0, 0);
    axesHelper.add(xLabel);

    const yLabel = this.createAxisLabel('Y', '#86efac', labelScale);
    yLabel.position.set(0, 0, halfSize + offset);
    axesHelper.add(yLabel);

    const zLabel = this.createAxisLabel('Z', '#60a5fa', labelScale);
    zLabel.position.set(0, halfSize + offset, 0);
    axesHelper.add(zLabel);
  }

  private createAxisLabel(text: string, color: string, scale: number): THREE.Sprite {
    if (typeof document === 'undefined') {
      const fallbackMaterial = new THREE.SpriteMaterial({ color, depthTest: false, depthWrite: false });
      const fallbackSprite = new THREE.Sprite(fallbackMaterial);
      fallbackSprite.scale.setScalar(scale);
      return fallbackSprite;
    }

    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext('2d');
    if (!context) {
      const fallbackMaterial = new THREE.SpriteMaterial({ color, depthTest: false, depthWrite: false });
      const fallbackSprite = new THREE.Sprite(fallbackMaterial);
      fallbackSprite.scale.setScalar(scale);
      return fallbackSprite;
    }

    context.clearRect(0, 0, size, size);
    context.font = '700 72px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 10;
    context.strokeStyle = 'rgba(15, 23, 42, 0.75)';
    context.strokeText(text, size / 2, size / 2);
    context.shadowColor = 'rgba(15, 23, 42, 0.5)';
    context.shadowBlur = 12;
    context.fillStyle = color;
    context.fillText(text, size / 2, size / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    material.toneMapped = false;
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(scale);
    sprite.renderOrder = 1;
    sprite.userData['axisLabel'] = text;

    return sprite;
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
    this.updateWorkspaceSize(normalizedBox);
    this.updateBoundingBoxHelper(normalizedBox);
    this.currentBoundingBox = normalizedBox.clone();

    if (this.lastAppliedDivisions) {
      this.renderSplitPlanes(this.lastAppliedDivisions);
    } else {
      this.clearSplitPlanes();
    }

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
    this.currentBoundingBox = null;
    this.clearSplitPlanes();
    this.resetWorkspaceSize();
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

  private createDivisionControl(): FormControl<number> {
    return this.formBuilder.control(1, {
      validators: [
        Validators.required,
        Validators.min(1),
        Validators.max(this.maxDivisionSegments),
      ],
    });
  }

  private normalizeCounts(counts: DivisionCounts): DivisionCounts {
    const toSafeInteger = (value: number): number => {
      if (!Number.isFinite(value)) {
        return 1;
      }

      const floored = Math.floor(value);
      return Math.min(Math.max(floored, 1), this.maxDivisionSegments);
    };

    return {
      x: toSafeInteger(counts.x),
      y: toSafeInteger(counts.y),
      z: toSafeInteger(counts.z),
    };
  }

  private renderSplitPlanes(counts: DivisionCounts): void {
    this.clearSplitPlanes();

    if (!this.currentBoundingBox) {
      return;
    }

    const normalized = this.normalizeCounts(counts);
    const axisCounts: DivisionCounts = {
      x: normalized.x,
      y: normalized.z,
      z: normalized.y,
    };

    const boxSize = this.currentBoundingBox.getSize(new THREE.Vector3());
    const boxMin = this.currentBoundingBox.min.clone();
    const boxCenter = this.currentBoundingBox.getCenter(new THREE.Vector3());

    const thickness = Math.max(boxSize.x, boxSize.y, boxSize.z) * 0.005 || 0.5;

    const createPlaneMaterial = (color: number) =>
      new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

    const axisSettings: Array<{
      key: keyof DivisionCounts;
      size: [number, number, number];
      color: number;
      positionBuilder: (index: number, total: number) => THREE.Vector3;
    }> = [
      {
        key: 'x',
        size: [thickness, boxSize.y + thickness, boxSize.z + thickness],
        color: 0xf97316,
        positionBuilder: (index, total) =>
          new THREE.Vector3(
            boxMin.x + (boxSize.x * index) / total,
            boxCenter.y,
            boxCenter.z,
          ),
      },
      {
        key: 'y',
        size: [boxSize.x + thickness, thickness, boxSize.z + thickness],
        color: 0x60a5fa,
        positionBuilder: (index, total) =>
          new THREE.Vector3(
            boxCenter.x,
            boxMin.y + (boxSize.y * index) / total,
            boxCenter.z,
          ),
      },
      {
        key: 'z',
        size: [boxSize.x + thickness, boxSize.y + thickness, thickness],
        color: 0x34d399,
        positionBuilder: (index, total) =>
          new THREE.Vector3(
            boxCenter.x,
            boxCenter.y,
            boxMin.z + (boxSize.z * index) / total,
          ),
      },
    ];

    axisSettings.forEach(({ key, size, color, positionBuilder }) => {
      const totalSegments = axisCounts[key];
      const divisionCount = totalSegments - 1;

      if (divisionCount < 1) {
        return;
      }

      for (let index = 1; index <= divisionCount; index += 1) {
        const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
        const material = createPlaneMaterial(color);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(positionBuilder(index, totalSegments));
        mesh.renderOrder = 5;
        this.splitPlanesGroup.add(mesh);
      }
    });
  }

  private clearSplitPlanes(): void {
    const meshes = [...this.splitPlanesGroup.children];

    meshes.forEach((child) => {
      this.splitPlanesGroup.remove(child);
      const mesh = child as THREE.Mesh;

      if (mesh.geometry) {
        mesh.geometry.dispose();
      }

      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else if (material) {
        material.dispose();
      }
    });
  }
}
