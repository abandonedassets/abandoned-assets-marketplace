
// LOGIC LAYER: Calculation Refactor
interface DealMetrics {
  cost_basis: number;
  arv_projection: number;
  gross_arbitrage: number;
  net_profit: number;
  tax_reserve: number;
}

/**
 * Pure function to derive metrics from current row state.
 * Eliminates stale "stamped" values.
 */
export const deriveDealMetrics = (
  row: Pick<DealMetrics, 'cost_basis' | 'arv_projection'>
): Omit<DealMetrics, 'cost_basis' | 'arv_projection'> => {
  const gross_arbitrage = (row.arv_projection || 0) - (row.cost_basis || 0);
  return {
    gross_arbitrage,
    net_profit: gross_arbitrage * 0.7,
    tax_reserve: gross_arbitrage * 0.3,
  };
};

// Processing Loop Refactor
export const processDeals = (deals: DealMetrics[]): DealMetrics[] => {
  return deals.map((deal) => ({
    ...deal,
    ...deriveDealMetrics(deal),
  }));
};
