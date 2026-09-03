/** 10-year franchise operating expense projection (3% default inflation). */
export type OpexProjection = {
  base_annual_cost: number;
  inflation_rate: number;
  years: number[];
  annual_costs: number[];
  cumulative_costs: number[];
  total_10yr: number;
};

export function projectOperatingExpenses(
  baseAnnualCost: number,
  inflationRate = 0.03,
  years = 10,
): OpexProjection {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const yearLabels: number[] = [];
  const annual: number[] = [];
  const cumulative: number[] = [];
  let running = 0;

  for (let i = 0; i < years; i += 1) {
    const cost = round2(baseAnnualCost * Math.pow(1 + inflationRate, i));
    running = round2(running + cost);
    yearLabels.push(i + 1);
    annual.push(cost);
    cumulative.push(running);
  }

  return {
    base_annual_cost: round2(baseAnnualCost),
    inflation_rate: inflationRate,
    years: yearLabels,
    annual_costs: annual,
    cumulative_costs: cumulative,
    total_10yr: running,
  };
}
