import React, { useState, useEffect } from 'react';
import { useAetherStore, resolvePendingAiApproval } from '../stores/aetherStore';
import {
  ShieldAlert,
  AlertTriangle,
  Check,
  X,
  Repeat,
  FileCode,
  Terminal,
  Trash2,
  Lock,
} from 'lucide-react';

export const AiApprovalModal: React.FC = () => {
  const store = useAetherStore();
  const pending = store.pendingAiApproval;
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    setRejectReason('');
  }, [pending?.id]);

  useEffect(() => {
    if (!pending) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolvePendingAiApproval(false, false, rejectReason.trim() || 'Rejected by user');
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || document.activeElement?.tagName !== 'INPUT')) {
        e.preventDefault();
        resolvePendingAiApproval(true, false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pending, rejectReason]);

  if (!pending) return null;

  const isTier3 = pending.tier === 3;

  const getActionIcon = () => {
    if (pending.toolName === 'fs_delete_path') {
      return <Trash2 className="w-5 h-5 text-cortex-error shrink-0" />;
    }
    if (pending.toolName === 'pane_send_input' || pending.toolName === 'sendPtyInput') {
      return <Terminal className="w-5 h-5 text-cortex-accent shrink-0" />;
    }
    if (pending.toolName.startsWith('fs_')) {
      return <FileCode className="w-5 h-5 text-cortex-warning shrink-0" />;
    }
    return <Lock className="w-5 h-5 text-cortex-accent shrink-0" />;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans select-none animate-fadeIn"
      data-testid="ai-approval-modal"
    >
      <div
        className={`w-full max-w-2xl bg-cortex-bgAlt border rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
          isTier3
            ? 'border-cortex-error/60 shadow-[0_0_24px_rgba(255,59,92,0.25)]'
            : 'border-cortex-warning/60 shadow-[0_0_24px_rgba(255,184,0,0.2)]'
        }`}
      >
        {/* Header Banner */}
        <div
          className={`px-4 py-3 flex items-center justify-between border-b ${
            isTier3
              ? 'bg-cortex-error/10 border-cortex-error/30 text-cortex-error'
              : 'bg-cortex-warning/10 border-cortex-warning/30 text-cortex-warning'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {isTier3 ? (
              <ShieldAlert className="w-5 h-5 text-cortex-error shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-cortex-warning shrink-0" />
            )}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider font-mono">
                {isTier3 ? 'Security Gatekeeper: High-Risk Action' : 'Action Approval Required'}
              </div>
              <div className="text-[11px] text-cortex-textMuted font-mono">
                Security Tier {pending.tier} Human-in-the-Loop Guardrail
              </div>
            </div>
          </div>

          <button
            onClick={() => resolvePendingAiApproval(false, false, 'Approval cancelled by user')}
            className="p-1 text-cortex-textMuted hover:text-cortex-text rounded transition-colors"
            title="Cancel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4 text-xs font-sans">
          {/* Action Header Card */}
          <div className="bg-cortex-surface1 border border-cortex-border rounded p-3 flex items-start gap-3">
            {getActionIcon()}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-cortex-text flex items-center gap-2">
                <span>{pending.actionType}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cortex-surface2 border border-cortex-border text-cortex-textMuted">
                  {pending.toolName}
                </span>
              </div>
              <p className="text-[11px] text-cortex-textMuted mt-1 leading-relaxed">
                {pending.riskReason}
              </p>
            </div>
          </div>

          {/* Unified Diff / Exact Payload Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-cortex-textMuted font-mono">
              <span className="font-semibold uppercase tracking-wider text-cortex-text">
                Payload / Operation Preview:
              </span>
              <span>{pending.payloadPreview.length} characters</span>
            </div>
            <pre className="p-3 bg-cortex-bg border border-cortex-border rounded font-mono text-[11px] text-cortex-text leading-relaxed overflow-x-auto max-h-56 select-text whitespace-pre-wrap break-all">
              {pending.payloadPreview || '(Empty payload)'}
            </pre>
          </div>

          {/* Optional Rejection Instructions */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-cortex-textMuted flex items-center justify-between">
              <span>Instruction for AI on Rejection (Optional):</span>
              <span className="font-normal text-[10px] text-cortex-textMuted/70 font-mono">
                Feeds feedback into AI conversation
              </span>
            </label>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Do not delete this file, move it to backup instead..."
              className="w-full px-3 py-2 bg-cortex-surface1 border border-cortex-border rounded text-xs text-cortex-text placeholder-cortex-textMuted/50 focus:outline-none focus:border-cortex-accent transition-colors font-sans"
              data-testid="input-reject-reason"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 bg-cortex-surface2 border-t border-cortex-border flex flex-wrap items-center justify-between gap-2">
          {/* Left: Rejection */}
          <button
            type="button"
            onClick={() => resolvePendingAiApproval(false, false, rejectReason.trim() || 'Rejected by user')}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-cortex-surface1 hover:bg-cortex-border text-cortex-text transition-colors flex items-center gap-1.5 border border-cortex-border"
            data-testid="btn-reject-instruct"
          >
            <X className="w-3.5 h-3.5 text-cortex-error" />
            <span>Reject & Instruct AI (Esc)</span>
          </button>

          {/* Right: Approval Actions */}
          <div className="flex items-center gap-2">
            {!isTier3 && (
              <button
                type="button"
                onClick={() => resolvePendingAiApproval(true, true)}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-cortex-surface1 hover:bg-cortex-border text-cortex-textMuted hover:text-cortex-text transition-colors flex items-center gap-1.5 border border-cortex-border"
                data-testid="btn-approve-session"
                title="Approve similar mutations for this session"
              >
                <Repeat className="w-3.5 h-3.5 text-cortex-accent" />
                <span>Approve Similar for This Session</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => resolvePendingAiApproval(true, false)}
              className={`px-4 py-1.5 text-xs font-bold rounded text-cortex-bg transition-all flex items-center gap-1.5 shadow-md ${
                isTier3
                  ? 'bg-cortex-error hover:bg-rose-400'
                  : 'bg-cortex-accent hover:bg-cortex-accentHover'
              }`}
              data-testid="btn-approve-execute"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Approve & Execute (Enter)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
