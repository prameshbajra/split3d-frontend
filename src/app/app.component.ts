import { Component } from '@angular/core';
import { ModelViewerComponent } from './features/viewer/components/model-viewer/model-viewer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ModelViewerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {}
