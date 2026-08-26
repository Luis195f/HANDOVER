import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DemoModeBanner } from '@/src/components/DemoModeBanner';
import {
  DEMO_RECEIVER_USER_ID,
  DEMO_USER_ID,
  ensureDemoSessionTemplate,
} from '@/src/demo/fixtures';

describe('DemoModeBanner actor switch', () => {
  const originalDemoFlag = process.env.EXPO_PUBLIC_ENABLE_DEMO;

  afterEach(() => {
    process.env.EXPO_PUBLIC_ENABLE_DEMO = originalDemoFlag;
  });

  it('shows the active actor and deliberate switch only for an explicitly enabled demo session', async () => {
    process.env.EXPO_PUBLIC_ENABLE_DEMO = 'true';
    const onSwitchActor = vi.fn(async () => undefined);
    const ui = render(
      <DemoModeBanner
        session={ensureDemoSessionTemplate(DEMO_USER_ID)}
        onSwitchActor={onSwitchActor}
      />,
    );

    expect(ui.getByTestId('demo-active-actor').props.children.join('')).toContain('saliente demo');
    fireEvent.press(ui.getByTestId('demo-switch-actor'));

    await waitFor(() => {
      expect(onSwitchActor).toHaveBeenCalledWith(DEMO_RECEIVER_USER_ID);
    });
  });

  it('does not expose the switch without the explicit demo flag', () => {
    delete process.env.EXPO_PUBLIC_ENABLE_DEMO;
    const ui = render(
      <DemoModeBanner
        session={ensureDemoSessionTemplate(DEMO_USER_ID)}
        onSwitchActor={vi.fn()}
      />,
    );

    expect(ui.getByTestId('demo-active-actor')).toBeTruthy();
    expect(ui.queryByTestId('demo-switch-actor')).toBeNull();
  });

  it('renders neither demo identity nor switch for an operational session', () => {
    process.env.EXPO_PUBLIC_ENABLE_DEMO = 'true';
    const ui = render(
      <DemoModeBanner
        session={{
          userId: 'operational-user',
          displayName: 'Operational User',
          roles: ['nurse'],
          units: ['unit-1'],
          accessToken: 'operational-token',
          mode: 'normal',
        }}
        onSwitchActor={vi.fn()}
      />,
    );

    expect(ui.queryByTestId('demo-active-actor')).toBeNull();
    expect(ui.queryByTestId('demo-switch-actor')).toBeNull();
  });
});
