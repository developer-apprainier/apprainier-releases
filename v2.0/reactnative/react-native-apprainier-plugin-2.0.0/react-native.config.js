module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath:
          'import com.apprainier.reactnative.AppRainierReactNativePluginPackage;',
        packageInstance: 'new AppRainierReactNativePluginPackage()',
      },
      ios: {},
    },
  },
};
