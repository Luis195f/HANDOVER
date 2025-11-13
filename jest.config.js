// BEGIN HANDOVER: JEST_BASE
module.exports = {
  preset: "react-native",
  setupFilesAfterEnv: ["@testing-library/jest-native/extend-expect"],
  transformIgnorePatterns: ["node_modules/(?!(@react-native|react-native|expo|expo-.*)/)"],
  moduleNameMapper: {
    "\\.(png|jpg|jpeg|gif|svg)$": "<rootDir>/__mocks__/fileMock.js",
    "\\.(css|less|scss)$": "<rootDir>/__mocks__/styleMock.js"
  }
};
// END HANDOVER: JEST_BASE
