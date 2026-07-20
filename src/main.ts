import { getChartContext } from '@thoughtspot/ts-chart-sdk';

type GaugeInputs = {
    value: number;
    minimum: number;
    maximum: number;
    warningStart: number;
    criticalStart: number;
    label: string;
    unit: string;
};

type GaugeResult =
    | { inputs: GaugeInputs; error: null }
    | { inputs: null; error: string };

const escapeHtml = (value: unknown): string => {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const parsedValue = Number(value.replace(/,/g, '').trim());

        return Number.isFinite(parsedValue) ? parsedValue : null;
    }

    return null;
};

/**
 * Finds each ThoughtSpot dataValue array in the chart payload.
 *
 * The exact surrounding payload structure can vary between the Playground
 * and the tenant, but the SDK data we have seen uses dataValue arrays.
 */
const findDataValueArrays = (value: unknown): unknown[][] => {
    const results: unknown[][] = [];
    const visited = new WeakSet<object>();

    const walk = (currentValue: unknown): void => {
        if (currentValue === null || currentValue === undefined) {
            return;
        }

        if (Array.isArray(currentValue)) {
            currentValue.forEach(walk);
            return;
        }

        if (typeof currentValue !== 'object') {
            return;
        }

        if (visited.has(currentValue)) {
            return;
        }

        visited.add(currentValue);

        const record = currentValue as Record<string, unknown>;

        if (Array.isArray(record.dataValue)) {
            results.push(record.dataValue);
        }

        Object.values(record).forEach(walk);
    };

    walk(value);

    return results;
};

/**
 * Required ThoughtSpot field order:
 *
 * 1. Current Value     - measure
 * 2. Minimum           - measure or formula
 * 3. Maximum           - measure or formula
 * 4. Warning Start     - measure or formula
 * 5. Critical Start    - measure or formula
 * 6. Label             - attribute/text
 * 7. Unit              - attribute/text
 */
const readGaugeInputs = (chartModel: unknown): GaugeResult => {
    const dataValueArrays = findDataValueArrays(chartModel);

    if (dataValueArrays.length < 7) {
        return {
            inputs: null,
            error: 'Waiting for the seven required gauge fields.',
        };
    }

    const rowCount = Math.max(
        ...dataValueArrays.slice(0, 7).map((dataValue) => dataValue.length),
    );

    if (rowCount === 0) {
        return {
            inputs: null,
            error: 'No data returned.',
        };
    }

    if (rowCount > 1) {
        return {
            inputs: null,
            error: 'Gauge requires one aggregated result, not multiple rows.',
        };
    }

    const [
        rawValue,
        rawMinimum,
        rawMaximum,
        rawWarningStart,
        rawCriticalStart,
        rawLabel,
        rawUnit,
    ] = dataValueArrays.slice(0, 7).map((dataValue) => dataValue[0]);

    const value = toNumber(rawValue);
    const minimum = toNumber(rawMinimum);
    const maximum = toNumber(rawMaximum);
    const warningStart = toNumber(rawWarningStart);
    const criticalStart = toNumber(rawCriticalStart);

    if (
        value === null ||
        minimum === null ||
        maximum === null ||
        warningStart === null ||
        criticalStart === null
    ) {
        return {
            inputs: null,
            error: 'Value, minimum, maximum, warning, and critical fields must be numeric.',
        };
    }

    if (maximum <= minimum) {
        return {
            inputs: null,
            error: 'Maximum must be greater than minimum.',
        };
    }

    if (warningStart < minimum || warningStart > maximum) {
        return {
            inputs: null,
            error: 'Warning Start must be between minimum and maximum.',
        };
    }

    if (criticalStart < warningStart || criticalStart > maximum) {
        return {
            inputs: null,
            error: 'Critical Start must be between Warning Start and Maximum.',
        };
    }

    return {
        inputs: {
            value,
            minimum,
            maximum,
            warningStart,
            criticalStart,
            label: String(rawLabel ?? 'GAUGE'),
            unit: String(rawUnit ?? ''),
        },
        error: null,
    };
};

const clamp = (value: number, minimum: number, maximum: number): number => {
    return Math.min(Math.max(value, minimum), maximum);
};

const getPercentage = (
    value: number,
    minimum: number,
    maximum: number,
): number => {
    return (clamp(value, minimum, maximum) - minimum) / (maximum - minimum);
};

/**
 * Gauge angle:
 * -90 = left
 *   0 = top
 *  90 = right
 */
const getGaugeAngle = (
    value: number,
    minimum: number,
    maximum: number,
): number => {
    return getPercentage(value, minimum, maximum) * 180 - 90;
};

const pointForGaugeAngle = (
    angle: number,
    radius: number,
): { x: number; y: number } => {
    const radians = (angle * Math.PI) / 180;

    return {
        x: 200 + radius * Math.sin(radians),
        y: 200 - radius * Math.cos(radians),
    };
};

const createArcPath = (
    startAngle: number,
    endAngle: number,
    radius = 140,
): string => {
    const startPoint = pointForGaugeAngle(startAngle, radius);
    const endPoint = pointForGaugeAngle(endAngle, radius);
    const sweepFlag = 1;
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

    return [
        `M ${startPoint.x.toFixed(2)} ${startPoint.y.toFixed(2)}`,
        `A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag}`,
        `${endPoint.x.toFixed(2)} ${endPoint.y.toFixed(2)}`,
    ].join(' ');
};

const createTickMarks = (
    minimum: number,
    maximum: number,
): string => {
    const ticks: string[] = [];
    const tickCount = 10;

    for (let index = 0; index <= tickCount; index += 1) {
        const percentage = index / tickCount;
        const angle = percentage * 180 - 90;
        const majorTick = index % 2 === 0;
        const tickStart = pointForGaugeAngle(angle, 126);
        const tickEnd = pointForGaugeAngle(angle, majorTick ? 110 : 116);

        ticks.push(`
            <line
                x1="${tickStart.x.toFixed(2)}"
                y1="${tickStart.y.toFixed(2)}"
                x2="${tickEnd.x.toFixed(2)}"
                y2="${tickEnd.y.toFixed(2)}"
                stroke="#eeeeee"
                stroke-width="${majorTick ? 3 : 2}"
            />
        `);

        if (majorTick) {
            const labelPoint = pointForGaugeAngle(angle, 96);
            const tickValue = minimum + (maximum - minimum) * percentage;

            ticks.push(`
                <text
                    x="${labelPoint.x.toFixed(2)}"
                    y="${(labelPoint.y + 5).toFixed(2)}"
                    text-anchor="middle"
                    fill="#dddddd"
                    font-size="12"
                    font-family="Arial, sans-serif"
                >
                    ${escapeHtml(tickValue.toFixed(0))}
                </text>
            `);
        }
    }

    return ticks.join('');
};

const renderMessage = (
    container: HTMLElement,
    title: string,
    message: string,
): void => {
    container.innerHTML = `
        <div
            style="
                box-sizing: border-box;
                width: 100%;
                height: 100%;
                min-height: 280px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                background: #171717;
                color: #eeeeee;
                font-family: Arial, sans-serif;
                text-align: center;
            "
        >
            <div>
                <div style="font-size: 20px; font-weight: 700; margin-bottom: 10px;">
                    ${escapeHtml(title)}
                </div>
                <div style="color: #bdbdbd; font-size: 14px;">
                    ${escapeHtml(message)}
                </div>
            </div>
        </div>
    `;
};

const renderGauge = (
    container: HTMLElement,
    inputs: GaugeInputs,
): void => {
    const {
        value,
        minimum,
        maximum,
        warningStart,
        criticalStart,
        label,
        unit,
    } = inputs;

    const displayedValue = clamp(value, minimum, maximum);
    const needleAngle = getGaugeAngle(displayedValue, minimum, maximum);
    const warningAngle = getGaugeAngle(warningStart, minimum, maximum);
    const criticalAngle = getGaugeAngle(criticalStart, minimum, maximum);

    const status =
        value >= criticalStart
            ? 'CRITICAL'
            : value >= warningStart
              ? 'WARNING'
              : 'NORMAL';

    const statusColor =
        status === 'CRITICAL'
            ? '#ff453a'
            : status === 'WARNING'
              ? '#ffb000'
              : '#42d96b';

    const safeLabel = escapeHtml(label.toUpperCase());
    const safeUnit = escapeHtml(unit);
    const ticks = createTickMarks(minimum, maximum);

    container.innerHTML = `
        <div
            style="
                box-sizing: border-box;
                width: 100%;
                height: 100%;
                min-height: 280px;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                background: radial-gradient(circle at center, #3a3a3a 0%, #151515 72%);
            "
        >
            <svg
                viewBox="0 0 400 300"
                role="img"
                aria-label="${safeLabel}: ${value.toFixed(1)} ${safeUnit}"
                style="
                    width: 100%;
                    height: 100%;
                    max-width: 540px;
                    min-height: 280px;
                "
            >
                <!-- Outer bezel and gauge face -->
                <circle
                    cx="200"
                    cy="200"
                    r="166"
                    fill="#1b1b1b"
                    stroke="#9b9b9b"
                    stroke-width="10"
                />
                <circle
                    cx="200"
                    cy="200"
                    r="151"
                    fill="#070707"
                    stroke="#3e3e3e"
                    stroke-width="3"
                />

                <!-- Dynamic threshold zones -->
                <path
                    d="${createArcPath(-90, warningAngle)}"
                    fill="none"
                    stroke="#42d96b"
                    stroke-width="13"
                />
                <path
                    d="${createArcPath(warningAngle, criticalAngle)}"
                    fill="none"
                    stroke="#ffb000"
                    stroke-width="13"
                />
                <path
                    d="${createArcPath(criticalAngle, 90)}"
                    fill="none"
                    stroke="#ff453a"
                    stroke-width="13"
                />

                <!-- Tick marks and range labels -->
                ${ticks}

                <!-- Gauge title -->
                <text
                    x="200"
                    y="135"
                    text-anchor="middle"
                    fill="#ffffff"
                    font-size="18"
                    font-weight="700"
                    font-family="Arial, sans-serif"
                    letter-spacing="1"
                >
                    ${safeLabel}
                </text>

                <!-- Needle -->
                <g transform="rotate(${needleAngle.toFixed(2)} 200 200)">
                    <line
                        x1="200"
                        y1="200"
                        x2="200"
                        y2="82"
                        stroke="#ff453a"
                        stroke-width="6"
                        stroke-linecap="round"
                    />
                    <line
                        x1="200"
                        y1="200"
                        x2="200"
                        y2="96"
                        stroke="#ffd0cc"
                        stroke-width="2"
                        stroke-linecap="round"
                    />
                </g>

                <!-- Needle hub -->
                <circle
                    cx="200"
                    cy="200"
                    r="16"
                    fill="#222222"
                    stroke="#9a9a9a"
                    stroke-width="4"
                />
                <circle cx="200" cy="200" r="6" fill="#ff453a" />

                <!-- Digital readout -->
                <rect
                    x="126"
                    y="224"
                    width="148"
                    height="45"
                    rx="5"
                    fill="#101010"
                    stroke="#4d4d4d"
                    stroke-width="2"
                />
                <text
                    x="200"
                    y="253"
                    text-anchor="middle"
                    fill="${statusColor}"
                    font-size="27"
                    font-weight="700"
                    font-family="Consolas, monospace"
                >
                    ${escapeHtml(value.toFixed(1))}
                </text>

                <text
                    x="200"
                    y="285"
                    text-anchor="middle"
                    fill="${statusColor}"
                    font-size="12"
                    font-family="Arial, sans-serif"
                    letter-spacing="1.25"
                >
                    ${safeUnit}${safeUnit ? ' • ' : ''}${status}
                </text>
            </svg>
        </div>
    `;
};

const render = (context: any): Promise<void> => {
    const container = document.getElementById('container');

    if (!container) {
        return Promise.resolve();
    }

    const chartModel = context.getChartModel();
    const result = readGaugeInputs(chartModel);

    if (result.error || !result.inputs) {
        renderMessage(container, 'Gauge Configuration', result.error ?? 'No data.');
        return Promise.resolve();
    }

    renderGauge(container, result.inputs);

    return Promise.resolve();
};

const init = async (): Promise<void> => {
    const context = await getChartContext({
        getDefaultChartConfig: (chartModel: any) => {
            const columns = chartModel?.columns ?? [];

            if (!Array.isArray(columns) || columns.length === 0) {
                return [];
            }

            return [
                {
                    key: 'gauge-data',
                    dimensions: [
                        {
                            key: 'gauge-fields',
                            columns,
                        },
                    ],
                },
            ];
        },

        getQueriesFromChartConfig: (chartConfig: any[]) => {
            const columns = chartConfig?.[0]?.dimensions?.[0]?.columns ?? [];

            return [
                {
                    queryColumns: columns,
                },
            ];
        },

        renderChart: (context: any) => render(context),
    });

    render(context);
};

init();