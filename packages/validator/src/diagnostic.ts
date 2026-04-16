export interface Diagnostic {
  code: string;
  message: string;
  path: string;
}

export interface ValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}
