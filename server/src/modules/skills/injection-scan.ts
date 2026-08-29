// Compatibility re-export for older imports. The implementation is shared by
// skills, agents, and review execution so feature modules do not depend on one
// another merely to reuse the security heuristic.
export {
  scanForInjectionRisk,
  type InjectionScanResult,
} from '../_shared/injection-scan.js';
