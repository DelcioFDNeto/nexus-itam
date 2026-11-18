// src/utils/sheetFormulaEngine.js
// =============================================================================
// Motor de Fórmulas & Formatação para Console (React 19) e Portal (Vue 3)
// Re-exporta a implementação canônica compartilhada com o backend.
// =============================================================================

export {
  colLettersToIndex,
  indexToColLetters,
  parseCellRef,
  expandCellRange,
  parseLocalizedNumber,
  evaluateFormula,
  evaluateFormula as evaluateCellValue,
  formatCellValue,
  formatValue,
  evaluateWorkbook,
  recalculateWorkbook,
  evaluateSheets,
  evaluateSheets as evaluateSheetFormulas,
  evaluateSheet,
} from '../../services/shared/sheetFormula.js';
