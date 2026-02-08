import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { PrimaryButton } from '../PrimaryButton';

describe('PrimaryButton', () => {
  it('exposes accessibility role and label', () => {
    const onPress = vi.fn();
    const { getByRole, getByLabelText } = render(
      <PrimaryButton label="Save" onPress={onPress} accessibilityHint="Saves the form" />,
    );

    const button = getByRole('button');
    expect(button.props.accessibilityLabel).toBe('Save');
    expect(button.props.accessibilityHint).toBe('Saves the form');
    expect(getByLabelText('Save')).toBeTruthy();
  });
});
