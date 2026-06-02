import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

typedef JsonMap = Map<String, Object?>;
typedef AppRainierEventListener = void Function(AppRainierEventPayload payload);

@immutable
class AppRainierUserProfile {
  const AppRainierUserProfile({
    required this.userId,
    this.userType = 'registered',
    this.userProperties = const <String, Object?>{},
    this.appProperties = const <String, Object?>{},
    this.deviceProperties = const <String, Object?>{},
    this.customProperties = const <String, Object?>{},
  });

  final String userId;
  final String userType;
  final JsonMap userProperties;
  final JsonMap appProperties;
  final JsonMap deviceProperties;
  final JsonMap customProperties;
}

@immutable
class AppRainierMessageCenterOptions {
  const AppRainierMessageCenterOptions({
    this.initialTab,
    this.announcementId,
    this.threadId,
  });

  final String? initialTab;
  final String? announcementId;
  final String? threadId;

  JsonMap toMap() => <String, Object?>{
    'initialTab': initialTab,
    'announcementId': announcementId,
    'threadId': threadId,
  };
}

@immutable
class AppRainierConversionOptions {
  const AppRainierConversionOptions({
    this.goalId,
    this.value,
    this.context = const <String, Object?>{},
  });

  final String? goalId;
  final Object? value;
  final JsonMap context;
}

@immutable
class AppRainierEventPayload {
  const AppRainierEventPayload({required this.name, required this.data});

  final String name;
  final JsonMap data;

  String? get surveyId => data['surveyId'] as String?;
  String? get announcementId => data['announcementId'] as String?;
  String? get deepLink => data['deepLink'] as String?;
  String? get targetScreen => data['targetScreen'] as String?;
}

class AppRainierEvents {
  const AppRainierEvents._();

  static const surveySubmitted = 'AppRainierSurveySubmitted';
  static const surveyCancelled = 'AppRainierSurveyCancelled';
  static const surveyDismissed = 'AppRainierSurveyDismissed';
  static const announcementSubmitted = 'AppRainierAnnouncementSubmitted';
  static const announcementCancelled = 'AppRainierAnnouncementCancelled';
  static const announcementDismissed = 'AppRainierAnnouncementDismissed';
}

class AppRainierSubscription {
  const AppRainierSubscription(this._subscription);

  final StreamSubscription<AppRainierEventPayload> _subscription;

  Future<void> cancel() => _subscription.cancel();
}

class AppRainierSurveyCallback {
  const AppRainierSurveyCallback({
    this.onSurveySubmitted,
    this.onSurveyCancelled,
    this.onSurveyDismissed,
  });

  final AppRainierEventListener? onSurveySubmitted;
  final AppRainierEventListener? onSurveyCancelled;
  final AppRainierEventListener? onSurveyDismissed;
}

class AppRainierAnnouncementCallback {
  const AppRainierAnnouncementCallback({
    this.onAnnouncementSubmitted,
    this.onAnnouncementCancelled,
    this.onAnnouncementDismissed,
  });

  final AppRainierEventListener? onAnnouncementSubmitted;
  final AppRainierEventListener? onAnnouncementCancelled;
  final AppRainierEventListener? onAnnouncementDismissed;
}

class AppRainier {
  AppRainier._();

  static const MethodChannel _channel = MethodChannel(
    'flutter_apprainier_plugin',
  );
  static const EventChannel _eventsChannel = EventChannel(
    'flutter_apprainier_plugin/events',
  );

  static Stream<AppRainierEventPayload>? _events;

  static Stream<AppRainierEventPayload> get events {
    return _events ??= _eventsChannel.receiveBroadcastStream().map((event) {
      final data = _asJsonMap(event);
      final name = _string(data['name'], 'event name');
      final payload = _asJsonMap(data['payload']);
      return AppRainierEventPayload(name: name, data: payload);
    }).asBroadcastStream();
  }

  static Future<String> initialize(
    String apiKey, {
    String environment = 'production',
  }) async {
    return _invoke<String>('initialize', <String, Object?>{
      'apiKey': _nonEmpty(apiKey, 'apiKey'),
      'environment': _nonEmpty(environment, 'environment'),
    });
  }

  static Future<String> initializeWithConfig(JsonMap config) async {
    return _invoke<String>('initializeWithConfig', <String, Object?>{
      'config': config,
    });
  }

  static Future<String> initializeFromConfigAsset(
    String assetPath, {
    AssetBundle? bundle,
  }) async {
    final jsonString = await (bundle ?? rootBundle).loadString(assetPath);
    final decoded = jsonDecode(jsonString);
    if (decoded is! Map) {
      throw ArgumentError(
        'AppRainier config asset must contain a JSON object.',
      );
    }
    return initializeWithConfig(
      decoded.map((key, value) => MapEntry(key.toString(), value)),
    );
  }

  static Future<bool> identify(
    String userId, {
    JsonMap traits = const <String, Object?>{},
  }) {
    return _invokeBool('identify', <String, Object?>{
      'userId': _nonEmpty(userId, 'userId'),
      'traits': traits,
    });
  }

  static Future<bool> resetUser({String reason = 'manual_reset'}) {
    return _invokeBool('resetUser', <String, Object?>{
      'reason': _nonEmpty(reason, 'reason'),
    });
  }

  static Future<bool> setUserProfile(AppRainierUserProfile profile) {
    return _invokeBool('setUserProfile', <String, Object?>{
      'userId': _nonEmpty(profile.userId, 'profile.userId'),
      'userType': _nonEmpty(profile.userType, 'profile.userType'),
      'userProperties': profile.userProperties,
      'appProperties': profile.appProperties,
      'deviceProperties': profile.deviceProperties,
      'customProperties': profile.customProperties,
    });
  }

  static Future<bool> setUserProperty(String key, Object? value) {
    return _setProperty('setUserProperty', key, value);
  }

  static Future<bool> setAppProperty(String key, Object? value) {
    return _setProperty('setAppProperty', key, value);
  }

  static Future<bool> setDeviceProperty(String key, Object? value) {
    return _setProperty('setDeviceProperty', key, value);
  }

  static Future<bool> setCustomProperty(String key, Object? value) {
    return _setProperty('setCustomProperty', key, value);
  }

  static Future<bool> setUserType(String userType) {
    return _invokeBool('setUserType', <String, Object?>{
      'userType': _nonEmpty(userType, 'userType'),
    });
  }

  static Future<bool> refreshFeatureFlags({bool force = false}) {
    return _invokeBool('refreshFeatureFlags', <String, Object?>{
      'force': force,
    });
  }

  static Future<T?> getFeatureFlag<T>(String flagKey, T defaultValue) async {
    final value = await _channel.invokeMethod<Object?>(
      'getFeatureFlag',
      <String, Object?>{
        'flagKey': _nonEmpty(flagKey, 'flagKey'),
        'defaultValue': defaultValue,
      },
    );
    return value is T ? value : defaultValue;
  }

  static Future<JsonMap?> getExperimentVariation(String flagKey) async {
    final value = await _channel.invokeMethod<Object?>(
      'getExperimentVariation',
      <String, Object?>{'flagKey': _nonEmpty(flagKey, 'flagKey')},
    );
    return value == null ? null : _asJsonMap(value);
  }

  static Future<JsonMap?> getExperimentConfig(String flagKey) async {
    final value = await _channel.invokeMethod<Object?>(
      'getExperimentConfig',
      <String, Object?>{'flagKey': _nonEmpty(flagKey, 'flagKey')},
    );
    return value == null ? null : _asJsonMap(value);
  }

  static Future<bool> trackExperimentExposure(
    String flagKey, {
    JsonMap context = const <String, Object?>{},
  }) {
    return _invokeBool('trackExperimentExposure', <String, Object?>{
      'flagKey': _nonEmpty(flagKey, 'flagKey'),
      'context': context,
    });
  }

  static Future<bool> trackExperimentConversion(
    String flagKey, {
    AppRainierConversionOptions options = const AppRainierConversionOptions(),
  }) {
    return _invokeBool('trackExperimentConversion', <String, Object?>{
      'flagKey': _nonEmpty(flagKey, 'flagKey'),
      'goalId': options.goalId,
      'value': options.value,
      'context': options.context,
    });
  }

  static Future<bool> trackEvent(
    String eventName, {
    JsonMap properties = const <String, Object?>{},
    String eventType = 'custom',
  }) {
    return _invokeBool('trackEvent', <String, Object?>{
      'eventName': _nonEmpty(eventName, 'eventName'),
      'properties': properties,
      'eventType': _nonEmpty(eventType, 'eventType'),
    });
  }

  static Future<bool> refreshSurveys({bool force = false}) {
    return _invokeBool('refreshSurveys', <String, Object?>{'force': force});
  }

  static Future<bool> canShowSurvey(String eventName) {
    return _invokeBool('canShowSurvey', <String, Object?>{
      'eventName': _nonEmpty(eventName, 'eventName'),
    });
  }

  static Future<bool> showSurvey(String eventName) {
    return _invokeBool('showSurvey', <String, Object?>{
      'eventName': _nonEmpty(eventName, 'eventName'),
    });
  }

  static Future<bool> refreshAnnouncements({bool force = false}) {
    return _invokeBool('refreshAnnouncements', <String, Object?>{
      'force': force,
    });
  }

  static Future<bool> canShowAnnouncement(String eventName) {
    return _invokeBool('canShowAnnouncement', <String, Object?>{
      'eventName': _nonEmpty(eventName, 'eventName'),
    });
  }

  static Future<bool> showAnnouncement(String eventName) {
    return _invokeBool('showAnnouncement', <String, Object?>{
      'eventName': _nonEmpty(eventName, 'eventName'),
    });
  }

  static Future<bool> refreshLiveCards({bool force = true}) {
    return _invokeBool('refreshLiveCards', <String, Object?>{'force': force});
  }

  static Future<bool> hasLiveCard(String triggerId) {
    return _invokeBool('hasLiveCard', <String, Object?>{
      'triggerId': _nonEmpty(triggerId, 'triggerId'),
    });
  }

  static Future<bool> refreshMessageCenter() {
    return _invokeBool('refreshMessageCenter');
  }

  static Future<bool> openMessageCenter({
    AppRainierMessageCenterOptions options =
        const AppRainierMessageCenterOptions(),
  }) {
    return _invokeBool('openMessageCenter', options.toMap());
  }

  static Future<int> getUnreadMessageCount() {
    return _invoke<int>('getUnreadMessageCount');
  }

  static Future<bool> onPushTokenRefreshed(String token) {
    return _invokeBool('onPushTokenRefreshed', <String, Object?>{
      'token': _nonEmpty(token, 'token'),
    });
  }

  static Future<bool> isAppRainierPush(JsonMap payload) {
    return _invokeBool('isAppRainierPush', <String, Object?>{
      'payload': payload,
    });
  }

  static Future<bool> handlePushMessage(
    JsonMap payload, {
    String? notificationTitle,
    String? notificationBody,
  }) {
    return _invokeBool('handlePushMessage', <String, Object?>{
      'payload': payload,
      'notificationTitle': notificationTitle,
      'notificationBody': notificationBody,
    });
  }

  static Future<String?> getUserId() {
    return _channel.invokeMethod<String?>('getUserId');
  }

  static Future<JsonMap?> getUserDebugState() async {
    final value = await _channel.invokeMethod<Object?>('getUserDebugState');
    return value == null ? null : _asJsonMap(value);
  }

  static Future<bool> flush() => _invokeBool('flush');

  static Future<bool> shutdown() => _invokeBool('shutdown');

  static AppRainierSubscription addSurveyCallback(
    AppRainierSurveyCallback callback,
  ) {
    return AppRainierSubscription(
      events.listen((event) {
        switch (event.name) {
          case AppRainierEvents.surveySubmitted:
            callback.onSurveySubmitted?.call(event);
          case AppRainierEvents.surveyCancelled:
            callback.onSurveyCancelled?.call(event);
          case AppRainierEvents.surveyDismissed:
            callback.onSurveyDismissed?.call(event);
        }
      }),
    );
  }

  static AppRainierSubscription addAnnouncementCallback(
    AppRainierAnnouncementCallback callback,
  ) {
    return AppRainierSubscription(
      events.listen((event) {
        switch (event.name) {
          case AppRainierEvents.announcementSubmitted:
            callback.onAnnouncementSubmitted?.call(event);
          case AppRainierEvents.announcementCancelled:
            callback.onAnnouncementCancelled?.call(event);
          case AppRainierEvents.announcementDismissed:
            callback.onAnnouncementDismissed?.call(event);
        }
      }),
    );
  }

  static Future<bool> _setProperty(String method, String key, Object? value) {
    return _invokeBool(method, <String, Object?>{
      'key': _nonEmpty(key, 'key'),
      'value': value,
    });
  }

  static Future<bool> _invokeBool(String method, [JsonMap? arguments]) async {
    return _invoke<bool>(method, arguments);
  }

  static Future<T> _invoke<T>(String method, [JsonMap? arguments]) async {
    final value = await _channel.invokeMethod<T>(method, arguments);
    if (value == null) {
      throw StateError('AppRainier.$method returned null.');
    }
    return value;
  }

  static String _nonEmpty(String value, String name) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      throw ArgumentError.value(value, name, 'must be a non-empty string');
    }
    return trimmed;
  }

  static String _string(Object? value, String name) {
    if (value is String && value.trim().isNotEmpty) {
      return value;
    }
    throw StateError('AppRainier event payload is missing $name.');
  }

  static JsonMap _asJsonMap(Object? value) {
    if (value == null) {
      return <String, Object?>{};
    }
    if (value is Map) {
      return value.map((key, mapValue) => MapEntry(key.toString(), mapValue));
    }
    throw StateError(
      'Expected a map payload but received ${value.runtimeType}.',
    );
  }
}

class AppRainierLiveCardView extends StatefulWidget {
  const AppRainierLiveCardView({
    required this.triggerId,
    super.key,
    this.refreshKey = 0,
    this.onCardReady,
    this.onCardUnavailable,
    this.onCardClick,
    this.creationParams,
  });

  final String triggerId;
  final int refreshKey;
  final ValueChanged<JsonMap>? onCardReady;
  final ValueChanged<JsonMap>? onCardUnavailable;
  final ValueChanged<JsonMap>? onCardClick;
  final JsonMap? creationParams;

  @override
  State<AppRainierLiveCardView> createState() => _AppRainierLiveCardViewState();
}

class _AppRainierLiveCardViewState extends State<AppRainierLiveCardView> {
  MethodChannel? _viewChannel;

  static final Set<Factory<OneSequenceGestureRecognizer>>
  _nativeGestureRecognizers = <Factory<OneSequenceGestureRecognizer>>{
    Factory<OneSequenceGestureRecognizer>(() => EagerGestureRecognizer()),
  };

  @override
  Widget build(BuildContext context) {
    final params = <String, Object?>{
      ...?widget.creationParams,
      'triggerId': widget.triggerId,
      'refreshKey': widget.refreshKey,
    };

    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return AndroidView(
          viewType: 'flutter_apprainier_plugin/live_card',
          creationParams: params,
          creationParamsCodec: const StandardMessageCodec(),
          onPlatformViewCreated: _onPlatformViewCreated,
          gestureRecognizers: _nativeGestureRecognizers,
        );
      case TargetPlatform.iOS:
        return UiKitView(
          viewType: 'flutter_apprainier_plugin/live_card',
          creationParams: params,
          creationParamsCodec: const StandardMessageCodec(),
          onPlatformViewCreated: _onPlatformViewCreated,
          gestureRecognizers: _nativeGestureRecognizers,
        );
      default:
        return const SizedBox.shrink();
    }
  }

  void _onPlatformViewCreated(int id) {
    _viewChannel = MethodChannel('flutter_apprainier_plugin/live_card_$id')
      ..setMethodCallHandler(_handleLiveCardEvent);
  }

  Future<void> _handleLiveCardEvent(MethodCall call) async {
    final payload = AppRainier._asJsonMap(call.arguments);
    switch (call.method) {
      case 'onCardReady':
        widget.onCardReady?.call(payload);
      case 'onCardUnavailable':
        widget.onCardUnavailable?.call(payload);
      case 'onCardClick':
        widget.onCardClick?.call(payload);
    }
  }

  @override
  void dispose() {
    _viewChannel?.setMethodCallHandler(null);
    super.dispose();
  }
}
