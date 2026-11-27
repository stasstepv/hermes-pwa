import { useState } from 'react';
import type { UpdateCheck } from '@hermes-pwa/core';

interface UpdateNotificationProps {
  update: UpdateCheck;
  onDismiss: () => void;
}

export function UpdateNotification({ update, onDismiss }: UpdateNotificationProps) {
  const [copiedCommand, setCopiedCommand] = useState<string | undefined>();
  if (!update.updateAvailable) return null;

  const latest = update.latest ?? 'latest';
  const commandInstruction = update.instructions.find((item) => item.command);

  function copyCommand(command: string) {
    void navigator.clipboard?.writeText(command).then(
      () => setCopiedCommand(command),
      () => setCopiedCommand(undefined),
    );
  }

  return (
    <section className="hm-update" aria-label="Update available" data-testid="update-notification">
      <div className="hm-update__header">
        <div>
          <p className="hm-update__eyebrow">Update available</p>
          <h2 className="hm-update__title">
            Hermes PWA {update.current} → {latest}
          </h2>
        </div>
        <span className="hm-update__badge">Manual update required</span>
      </div>

      <p className="hm-update__body">
        A newer Hermes PWA release is available. Version {update.current} shows instructions only; it does not modify plugin files.
      </p>

      <div className="hm-update__instructions">
        {update.instructions.map((instruction) => (
          <div className="hm-update__instruction" key={instruction.id}>
            <strong>{instruction.label}</strong>
            {instruction.command ? (
              <div className="hm-update__command-row">
                <code>{instruction.command}</code>
                <button type="button" className="hm-update__copy" onClick={() => copyCommand(instruction.command!)}>
                  {copiedCommand === instruction.command ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : null}
            {instruction.steps.length > 0 ? (
              <ol>
                {instruction.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
          </div>
        ))}
      </div>

      {!commandInstruction ? null : (
        <p className="hm-update__hint hm-muted">Recommended CLI path: {commandInstruction.command}</p>
      )}

      <button type="button" className="hm-update__dismiss" onClick={onDismiss}>
        Dismiss this version
      </button>
    </section>
  );
}
