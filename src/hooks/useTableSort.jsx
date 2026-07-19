import { useMemo } from 'react';
import { useAppData } from '../context/AppDataContext.jsx';

/** Port of applySort()/toggleSort()/updateSortHeaders() as a hook — sortState itself lives in
    AppDataContext (shared/global, not per-page) so a table's sort survives navigating away and back. */
export function useTableSort(table, rows, getters) {
  const { sortState, toggleSort } = useAppData();
  const s = sortState[table];

  const sorted = useMemo(() => {
    if (!s || !getters[s.key]) return rows;
    const get = getters[s.key];
    return rows.slice().sort((a, b) => {
      const av = get(a), bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * s.dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * s.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, s && s.key, s && s.dir]);

  /** Spread onto a <th> to make it sortable: `<th {...sortTh('name')}>Name{sortArrow('name')}</th>` */
  function sortTh(key) {
    return {
      className: 'sortable' + (s && s.key === key ? ' sort-active' : ''),
      onClick: () => toggleSort(table, key),
    };
  }
  function sortArrow(key) {
    if (!s || s.key !== key) return null;
    return <span className="sort-arrow">{s.dir === 1 ? '↑' : '↓'}</span>;
  }

  return { sorted, sortTh, sortArrow };
}
