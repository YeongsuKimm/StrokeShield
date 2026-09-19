import { MAX_WEIGHTS, MIN_CONFIDENCE, RISK_THRESHOLD } from './config'
import { clamp01 } from './math'
import type { RiskBreakdown, RiskContribution, TestName, TestResult, VisionOpinion } from './contracts'

/**
 * Noisy-OR risk score (docs/spec/05):
 *   contribution_i = maxWeight_i * severity_i * confidence_i
 *   risk = 1 - prod(1 - contribution_i)
 * Retry / low-confidence results are excluded. Pure function: no DOM, no network.
 */
export function computeRisk(
  results: Partial<Record<TestName, TestResult>>,
  opinions: VisionOpinion[] = [],
  threshold: number = RISK_THRESHOLD,
): RiskBreakdown {
  const contributions: RiskContribution[] = []

  for (const r of Object.values(results)) {
    if (!r || r.needsRetry || r.confidence < MIN_CONFIDENCE) continue
    const weight = MAX_WEIGHTS[r.test]
    contributions.push({
      test: r.test,
      weight,
      severity: r.severity,
      confidence: r.confidence,
      contribution: clamp01(weight * r.severity * r.confidence),
    })
  }

  for (const o of opinions) {
    if (o.finding !== 'asymmetric') continue
    contributions.push({
      test: 'vision',
      weight: MAX_WEIGHTS.vision,
      severity: o.confidence,
      confidence: 1,
      contribution: clamp01(MAX_WEIGHTS.vision * o.confidence),
    })
  }

  const risk = 1 - contributions.reduce((acc, c) => acc * (1 - c.contribution), 1)
  return { risk, threshold, contributions, triggered: risk >= threshold }
}
