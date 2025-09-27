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

  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationFrameId: number | null = null;
  private currentModel: THREE.Object3D | null = null;
  private resizeObserver?: ResizeObserver;

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

    const gridHelper = new THREE.GridHelper(400, 20, 0x3b82f6, 0x1f2937);
    gridHelper.position.set(0, -1, 0);
    this.scene.add(gridHelper);

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

    model.position.set(0, 0, 0);
    this.scene.add(model);
    this.currentModel = model;

    fitCameraToObject(this.camera, model, this.controls);
  }

  private disposeCurrentModel(): void {
    if (!this.currentModel) {
      return;
    }

    this.scene.remove(this.currentModel);
    disposeObject(this.currentModel);

    this.currentModel = null;
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
