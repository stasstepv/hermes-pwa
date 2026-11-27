import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateCheck } from '@hermes-pwa/core';
import { UpdateNotification } from './UpdateNotification';

const update: UpdateCheck = {
  ok: true,
  current: '0.1.0',
  latest: '0.1.1',
  source: 'npm',
  updateAvailable: true,
  canApply: false,
  manualRequired: true,
  installMethod: 'unknown',
  instructions: [
    {
      id: 'web-ui-force-reinstall',
      label: 'Hermes Web UI / Git URL',
      steps: ['Open Hermes Web UI → Plugins', 'Enable Force reinstall'],
    },
    {
      id: 'npx-force-reinstall',
      label: 'npm / npx',
      command: 'npx -y hermes-pwa@latest install --force',
      steps: ['Run the command on the Hermes host'],
    },
  ],
};

describe('UpdateNotification', () => {
  it('renders update version and manual instructions', () => {
    render(<UpdateNotification update={update} onDismiss={vi.fn()} />);

    expect(screen.getByLabelText('Update available')).toBeInTheDocument();
    expect(screen.getByText('Hermes PWA 0.1.0 → 0.1.1')).toBeInTheDocument();
    expect(screen.getByText('Manual update required')).toBeInTheDocument();
    expect(screen.getByText('Hermes Web UI / Git URL')).toBeInTheDocument();
    expect(screen.getAllByText('npx -y hermes-pwa@latest install --force')[0]).toBeInTheDocument();
  });

  it('shows the installed version in the banner body', () => {
    render(
      <UpdateNotification update={{ ...update, current: '0.1.1-beta', latest: '0.1.2-beta' }} onDismiss={vi.fn()} />,
    );

    expect(screen.getByText('Hermes PWA 0.1.1-beta → 0.1.2-beta')).toBeInTheDocument();
    expect(
      screen.getByText(/Version 0\.1\.1-beta shows instructions only; it does not modify plugin files\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Version 0\.1\.0 /)).not.toBeInTheDocument();
  });

  it('calls dismiss handler', () => {
    const onDismiss = vi.fn();
    render(<UpdateNotification update={update} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this version' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render when no update is available', () => {
    render(<UpdateNotification update={{ ...update, updateAvailable: false, instructions: [] }} onDismiss={vi.fn()} />);

    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument();
  });
});
