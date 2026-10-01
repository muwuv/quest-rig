import { PressDepth } from "../components/ui/press-depth";

export function TokenEntry({
  draft,
  onDraft,
  onSubmit,
  checking,
  err,
}: {
  draft: string;
  onDraft: (v: string) => void;
  onSubmit: () => void;
  checking: boolean;
  err: string | null;
}) {
  return (
    <div className="token-empty">
      <form
        className="token-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <span className="token-field">
          <input
            id="dq-token"
            type="password"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder=" "
            spellCheck={false}
            autoComplete="off"
          />
          <label htmlFor="dq-token">Discord token</label>
        </span>
        <PressDepth
          type="submit"
          variant="primary"
          icon
          join="right"
          depth={4}
          tilt={4}
          faceHeight={30}
          style={{ width: 44, flex: "none" }}
          disabled={!draft.trim() || checking}
          title="Save token"
          ariaLabel="Save token"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13.3 4.3 6.5 11.1 2.7 7.3" />
          </svg>
        </PressDepth>
      </form>
      {err && <p className="vq-err token-err">{err}</p>}
      <p className="hint">
        Stored only on this PC, sent only to discord.com. A token is full
        account access: never share it, and change your password to revoke it.
      </p>
    </div>
  );
}
