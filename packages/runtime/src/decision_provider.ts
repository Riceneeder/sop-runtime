export interface Decision {
  run_id: string;
  step_id: string;
  attempt: number;
  outcome_id: string;
  reason?: string;
}

export interface DecisionProvider {
  decide(input: {
    run_id: string;
    step_id: string;
    attempt: number;
    result_status: string;
  }): Promise<Decision>;
}
