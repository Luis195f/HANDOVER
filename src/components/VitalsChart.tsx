// BEGIN HANDOVER: VITALS_CHART
import React from "react";
import { View } from "react-native";
import { VictoryChart, VictoryLine, VictoryScatter, VictoryAxis } from "victory-native";
type Pt={t:number; v:number};
export function VitalsChart({data}:{data:Pt[]}) {
  const children=[
    <VictoryAxis key="axis-y" dependentAxis/>,
    <VictoryAxis key="axis-x"/>,
    <VictoryLine key="line" data={data} x="t" y="v"/>,
    <VictoryScatter key="scatter" data={data} x="t" y="v"/>
  ];
  return (
    <View>
      <VictoryChart>
        {children as unknown as React.ReactNode}
      </VictoryChart>
    </View>
  );
}
// END HANDOVER: VITALS_CHART
