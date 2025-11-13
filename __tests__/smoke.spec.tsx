// BEGIN HANDOVER: TEST_SMOKE
import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";
function Hello(){ return <Text>Handover</Text>; }
it("renders", () => {
  const { getByText } = render(<Hello/>);
  expect(getByText("Handover")).toBeTruthy();
});
// END HANDOVER: TEST_SMOKE
