// src/components/StatusBadge.jsx
import React from 'react';
import { getStatus, statusBadgeClass, statusDotClass } from '../utils/assetStatus';

/**
 * Selo de status do ativo.
 *
 * As cores eram recalculadas com ternarios encadeados em quatro telas, e cada
 * uma cobria um subconjunto diferente de status — o resto caia num cinza mudo.
 */
const StatusBadge = ({ status, size = 'md', showDot = true, className = '' }) => {
  const { label } = getStatus(status);

  const dims =
    size === 'sm'
      ? 'px-2 py-0.5 text-xs gap-1'
      : 'px-2.5 py-1 text-xs gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full border font-bold uppercase tracking-wide whitespace-nowrap ${dims} ${statusBadgeClass(status)} ${className}`}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(status)}`}
        />
      )}
      {label}
    </span>
  );
};

export default StatusBadge;
