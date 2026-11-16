import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, TipFeatureConfig } from '../core/types';
import { cloneMaterials } from '../core/materials';
import { PRINTED_DEMO, defaultSettings } from '../core/defaults';

const KEY = 'cppr-studio.project.v1';
const HISTORY_LIMIT = 60;

export function normalizeProject(p: unknown): Project | null {
  if (!p || typeof p !== 'object') return null;
  const raw = p as Partial<Project>;
  if (raw.version !== 1 || !Array.isArray(raw.segments) || raw.segments.length === 0) return null;
  return {
    ...PRINTED_DEMO(),
    ...raw,
    version: 1,
    materials: Array.isArray(raw.materials) && raw.materials.length ? raw.materials : cloneMaterials(),
    settings: { ...defaultSettings(), ...(raw.settings ?? {}) },
    segments: raw.segments.map((s) => {
      const tf = (s.tipFeature ?? {}) as Partial<TipFeatureConfig>;
      return {
        ...s,
        innerExtension: s.innerExtension ?? 0,
        tipFeature: {
          enabled: false, extension: 6, holeDiameter: 2, holeDistance: 2,
          angleDeg: 90, ...tf,
        },
        transmission: { ...s.transmission, innerPattern: s.transmission?.innerPattern ?? 'same' },
      };
    }),
  } as Project;
}

function load(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = normalizeProject(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    /* ignore corrupt storage */
  }
  return PRINTED_DEMO();
}

export function useProject() {
  const [history, setHistory] = useState<{ past: Project[]; present: Project; future: Project[] }>(() => ({
    past: [],
    present: load(),
    future: [],
  }));
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(history.present));
      } catch {
        /* quota — ignore */
      }
    }, 400);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [history.present]);

  const setProject = useCallback((updater: (p: Project) => Project, recordHistory = true) => {
    setHistory((h) => {
      const next = updater(h.present);
      if (next === h.present) return h;
      next.updatedAt = new Date().toISOString();
      if (!recordHistory) return { ...h, present: next };
      return {
        past: [...h.past.slice(-HISTORY_LIMIT + 1), h.present],
        present: next,
        future: [],
      };
    });
  }, []);

  const replaceProject = useCallback((p: Project) => {
    setHistory({ past: [], present: p, future: [] });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future].slice(0, HISTORY_LIMIT) };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
    });
  }, []);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return useMemo(
    () => ({
      project: history.present,
      setProject,
      replaceProject,
      undo,
      redo,
      canUndo,
      canRedo,
    }),
    [history.present, setProject, replaceProject, undo, redo, canUndo, canRedo],
  );
}
