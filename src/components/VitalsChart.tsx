import React from 'react';
import { VictoryAxis, VictoryChart, VictoryLine } from 'victory-native';

type DataPoint = {
  t: number;
  value: number;
};

type Props = {
  data: DataPoint[];
};

export function VitalsChart({ data }: Props) {
  const elements: any[] = [
    <VictoryAxis key="axis-y" dependentAxis />,
    <VictoryAxis key="axis-x" tickFormat={(tick) => new Date(tick).toLocaleTimeString()} />,
    <VictoryLine key="line" data={data} x="t" y="value" />,
  ];
  return (
    <VictoryChart>
      {elements}
    </VictoryChart>
  );
}

export default VitalsChart;
