import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

export type DivisionFormGroup = FormGroup<{
  x: FormControl<number>;
  y: FormControl<number>;
  z: FormControl<number>;
}>;

@Component({
  selector: 'app-split-sidebar',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './split-sidebar.component.html',
  styleUrl: './split-sidebar.component.css',
})
export class SplitSidebarComponent {
  @Input({ required: true }) divisionForm!: DivisionFormGroup;
  @Input({ required: true }) maxDivisionSegments!: number;
  @Input({ required: true }) hasModelLoaded!: boolean;
  @Input({ required: true }) hasActiveSplits!: boolean;

  @Output() apply = new EventEmitter<void>();
  @Output() clear = new EventEmitter<void>();
}
