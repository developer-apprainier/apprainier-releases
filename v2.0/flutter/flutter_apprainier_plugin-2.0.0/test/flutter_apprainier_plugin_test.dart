import 'package:flutter/services.dart';
import 'package:flutter_apprainier_plugin/flutter_apprainier_plugin.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('flutter_apprainier_plugin');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('initialize forwards api key and environment to native layer', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          expect(call.method, 'initialize');
          expect(call.arguments, <String, Object?>{
            'apiKey': 'test-key',
            'environment': 'stage',
          });
          return 'ready';
        });

    expect(
      await AppRainier.initialize('test-key', environment: 'stage'),
      'ready',
    );
  });

  test('showSurvey validates trigger id and returns native result', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async => true);

    expect(await AppRainier.showSurvey('survey_star_rating_prompt'), isTrue);
    expect(() => AppRainier.showSurvey('   '), throwsArgumentError);
  });
}
