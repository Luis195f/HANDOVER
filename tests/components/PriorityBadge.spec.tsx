import React from 'react';
import { render } from '@testing-library/react-native';
import { afterEach, describe, expect, it } from 'vitest';

import PriorityBadge from '@/src/components/priority/PriorityBadge';
import { setLanguage } from '@/src/i18n';

describe('PriorityBadge', () => {
  afterEach(() => {
    setLanguage('es');
  });

  it('renders the active locale label in English', () => {
    setLanguage('en');

    const { getByText, getByLabelText } = render(<PriorityBadge level="critical" />);

    expect(getByText('CRITICAL')).toBeTruthy();
    expect(getByLabelText('CRITICAL')).toBeTruthy();
  });

  it('renders the active locale label in Spanish', () => {
    setLanguage('es');

    const { getByText, getByLabelText } = render(<PriorityBadge level="high" />);

    expect(getByText('ALTO')).toBeTruthy();
    expect(getByLabelText('ALTO')).toBeTruthy();
  });
});
