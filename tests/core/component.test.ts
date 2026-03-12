import { describe, it, expect, vi } from 'vitest';
import { Component } from '../../src/core/component';

class TestComponent extends Component<{ count: number }> {
    render = vi.fn();
}

describe('core/component.ts', () => {
    it('constructor should initialize state and container', () => {
        const container = document.createElement('div');
        const component = new TestComponent(container, { count: 0 });
        expect((component as any).container).toBe(container);
        expect((component as any).state).toEqual({ count: 0 });
    });

    it('setState should update state and call render', () => {
        const container = document.createElement('div');
        const component = new TestComponent(container, { count: 0 });
        component.setState({ count: 1 });
        expect((component as any).state).toEqual({ count: 1 });
        expect(component.render).toHaveBeenCalled();
    });

    it('clear should remove all children from container', () => {
        const container = document.createElement('div');
        container.innerHTML = '<span>1</span><span>2</span>';
        const component = new TestComponent(container, { count: 0 });
        (component as any).clear();
        expect(container.children.length).toBe(0);
        expect(container.innerHTML).toBe('');
    });
});
