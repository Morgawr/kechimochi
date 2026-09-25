import { describe, it, expect } from 'vitest';
import { selectVisibleTooltipElements } from '../../../src/dashboard/chart_runtime';

const DATASETS = [
    { data: [0, 30, 0] },
    { data: [45, 0, 0] },
];

const ALL_ELEMENTS = [
    { datasetIndex: 0, index: 0 },
    { datasetIndex: 0, index: 1 },
    { datasetIndex: 1, index: 0 },
    { datasetIndex: 1, index: 1 },
];

describe('selectVisibleTooltipElements', () => {
    it('returns no elements when the pointer is outside the chart area', () => {
        expect(selectVisibleTooltipElements(ALL_ELEMENTS, DATASETS, false, false)).toEqual([]);
        expect(selectVisibleTooltipElements(ALL_ELEMENTS, DATASETS, false, true)).toEqual([]);
    });

    it('drops zero-valued elements when hiding zero values', () => {
        expect(selectVisibleTooltipElements(ALL_ELEMENTS, DATASETS, true, true)).toEqual([
            { datasetIndex: 0, index: 1 },
            { datasetIndex: 1, index: 0 },
        ]);
    });

    it('keeps zero-valued elements when not hiding zero values', () => {
        expect(selectVisibleTooltipElements(ALL_ELEMENTS, DATASETS, true, false)).toEqual(ALL_ELEMENTS);
    });

    it('returns no elements when every hovered element is zero-valued', () => {
        const zeroElements = [
            { datasetIndex: 0, index: 2 },
            { datasetIndex: 1, index: 2 },
        ];

        expect(selectVisibleTooltipElements(zeroElements, DATASETS, true, true)).toEqual([]);
    });

    it('drops elements whose dataset no longer exists', () => {
        expect(selectVisibleTooltipElements([{ datasetIndex: 5, index: 0 }], DATASETS, true, true)).toEqual([]);
    });
});
