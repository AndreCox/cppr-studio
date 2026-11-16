import type { Project } from '../core/types';
import { EXAMPLES, newProject } from '../core/defaults';
import { Icon, Modal } from './ui';

export function ExamplesModal({ onClose, onLoad }: { onClose: () => void; onLoad: (p: Project) => void }) {
  return (
    <Modal
      title="Start from an example"
      subtitle="These projects are fully designed and ready to inspect, modify and fabricate."
      onClose={onClose}
      footer={<button type="button" className="btn" onClick={onClose}>Cancel</button>}
    >
      <div className="example-list">
        <button type="button" className="example-item" onClick={() => onLoad(newProject())}>
          <div className="t">Blank CPPR</div>
          <div className="d">One 4 mm nitinol segment with the paper's S-curve target. A clean starting point for your own design.</div>
        </button>
        {EXAMPLES.map((ex) => (
          <button key={ex.id} type="button" className="example-item" onClick={() => onLoad(ex.make())}>
            <div className="flex" style={{ justifyContent: 'space-between', gap: 10 }}>
              <div className="t">{ex.name}</div>
              <Icon name="arrowRight" className="sm" style={{ color: '#94a3b8' }} />
            </div>
            <div className="d">{ex.description}</div>
          </button>
        ))}
      </div>
      <div className="callout" style={{ marginTop: 14 }}>
        Loading an example replaces the current project. Save your work from the Fabricate tab first if you want to keep it.
      </div>
    </Modal>
  );
}
