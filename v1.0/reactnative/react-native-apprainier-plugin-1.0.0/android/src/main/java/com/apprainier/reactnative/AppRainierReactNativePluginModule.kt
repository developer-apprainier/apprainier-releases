package com.apprainier.reactnative

import com.apprainier.sdk.core.AnnouncementCallback
import com.apprainier.sdk.core.AppRainier
import com.apprainier.sdk.core.AppRainierSdkConfig
import com.apprainier.sdk.core.Environment
import com.apprainier.sdk.core.SurveyCallback
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Dynamic
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

class AppRainierReactNativePluginModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
    private val gson = Gson()

    override fun getName(): String = MODULE_NAME

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by React Native's NativeEventEmitter on Android.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required by React Native's NativeEventEmitter on Android.
    }

    @ReactMethod
    fun initialize(apiKey: String, environment: String, promise: Promise) {
        val didResolve = AtomicBoolean(false)
        try {
            AppRainier.initialize(
                reactContext.applicationContext,
                apiKey,
                Environment.fromValue(environment)
            ) { state ->
                if (didResolve.compareAndSet(false, true)) {
                    promise.resolve(state.toString())
                }
            }
        } catch (error: Exception) {
            promise.reject("APPRAINIER_INITIALIZE_FAILED", error)
        }
    }

    @ReactMethod
    fun initializeWithConfig(configMap: ReadableMap, promise: Promise) {
        val didResolve = AtomicBoolean(false)
        try {
            val config = AppRainierSdkConfig.fromJson(gson.toJson(readableMapToMap(configMap)))
            AppRainier.initialize(
                reactContext.applicationContext,
                config
            ) { state ->
                if (didResolve.compareAndSet(false, true)) {
                    promise.resolve(state.toString())
                }
            }
        } catch (error: Exception) {
            promise.reject("APPRAINIER_INITIALIZE_FAILED", error)
        }
    }

    @ReactMethod
    fun identify(userId: String, traits: ReadableMap?, promise: Promise) {
        runCatching {
            AppRainier.identify(userId, readableMapToMap(traits))
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_IDENTIFY_FAILED", it) }
    }

    @ReactMethod
    fun resetUser(reason: String?, promise: Promise) {
        runCatching {
            AppRainier.resetUser(reason ?: "manual_reset")
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_RESET_USER_FAILED", it) }
    }

    @ReactMethod
    fun setUserProfile(
        userId: String,
        userType: String,
        userProperties: ReadableMap?,
        appProperties: ReadableMap?,
        deviceProperties: ReadableMap?,
        customProperties: ReadableMap?,
        promise: Promise
    ) {
        runCatching {
            AppRainier.setUserProfile(
                userId = userId,
                userType = userType,
                userProperties = readableMapToMap(userProperties),
                appProperties = readableMapToMap(appProperties),
                deviceProperties = readableMapToMap(deviceProperties),
                customProperties = readableMapToMap(customProperties),
            )
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_SET_USER_PROFILE_FAILED", it) }
    }

    @ReactMethod
    fun setUserProperty(key: String, value: Dynamic, promise: Promise) {
        setProperty(promise) { AppRainier.setUserProperty(key, dynamicToAny(value) ?: "") }
    }

    @ReactMethod
    fun setAppProperty(key: String, value: Dynamic, promise: Promise) {
        setProperty(promise) { AppRainier.setAppProperty(key, dynamicToAny(value) ?: "") }
    }

    @ReactMethod
    fun setDeviceProperty(key: String, value: Dynamic, promise: Promise) {
        setProperty(promise) { AppRainier.setDeviceProperty(key, dynamicToAny(value) ?: "") }
    }

    @ReactMethod
    fun setCustomProperty(key: String, value: Dynamic, promise: Promise) {
        setProperty(promise) { AppRainier.setCustomProperty(key, dynamicToAny(value) ?: "") }
    }

    @ReactMethod
    fun setUserType(userType: String, promise: Promise) {
        setProperty(promise) { AppRainier.setUserType(userType) }
    }

    @ReactMethod
    fun refreshFeatureFlags(force: Boolean, promise: Promise) {
        runCatching {
            AppRainier.refreshFeatureFlags(force)
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_REFRESH_FLAGS_FAILED", it) }
    }

    @ReactMethod
    fun getFeatureFlag(flagKey: String, defaultValue: Dynamic, promise: Promise) {
        runCatching {
            val fallback = dynamicToAny(defaultValue) ?: false
            val value = AppRainier.getFeatureFlag(flagKey, fallback)
            promise.resolve(toPromiseValue(value))
        }.onFailure { promise.reject("APPRAINIER_GET_FLAG_FAILED", it) }
    }

    @ReactMethod
    fun getExperimentVariation(flagKey: String, promise: Promise) {
        runCatching {
            promise.resolve(jsonObjectToWritableMap(gson.toJson(AppRainier.getExperimentVariation(flagKey))))
        }.onFailure { promise.reject("APPRAINIER_GET_EXPERIMENT_VARIATION_FAILED", it) }
    }

    @ReactMethod
    fun getExperimentConfig(flagKey: String, promise: Promise) {
        runCatching {
            promise.resolve(jsonObjectToWritableMap(gson.toJson(AppRainier.getExperimentConfig(flagKey))))
        }.onFailure { promise.reject("APPRAINIER_GET_EXPERIMENT_CONFIG_FAILED", it) }
    }

    @ReactMethod
    fun trackExperimentExposure(flagKey: String, context: ReadableMap?, promise: Promise) {
        runCatching {
            AppRainier.trackExperimentExposure(flagKey, readableMapToMap(context))
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_TRACK_EXPOSURE_FAILED", it) }
    }

    @ReactMethod
    fun trackExperimentConversion(
        flagKey: String,
        goalId: String?,
        value: Dynamic,
        context: ReadableMap?,
        promise: Promise
    ) {
        runCatching {
            AppRainier.trackExperimentConversion(
                flagKey = flagKey,
                goalId = goalId,
                value = dynamicToAny(value),
                context = readableMapToMap(context)
            )
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_TRACK_CONVERSION_FAILED", it) }
    }

    @ReactMethod
    fun trackEvent(eventName: String, properties: ReadableMap?, eventType: String?, promise: Promise) {
        runCatching {
            AppRainier.trackEvent(eventName, readableMapToMap(properties), eventType ?: "custom")
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_TRACK_EVENT_FAILED", it) }
    }

    @ReactMethod
    fun refreshSurveys(force: Boolean, promise: Promise) {
        runCatching {
            AppRainier.refreshSurveys(force)
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_REFRESH_SURVEYS_FAILED", it) }
    }

    @ReactMethod
    fun canShowSurvey(eventName: String, promise: Promise) {
        runCatching { promise.resolve(AppRainier.canShowSurvey(eventName)) }
            .onFailure { promise.reject("APPRAINIER_CAN_SHOW_SURVEY_FAILED", it) }
    }

    @ReactMethod
    fun showSurvey(eventName: String, promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("APPRAINIER_NO_ACTIVITY", "No foreground Activity is available.")
            return
        }
        UiThreadUtil.runOnUiThread {
            runCatching {
                if (!AppRainier.canShowSurvey(eventName)) {
                    promise.resolve(false)
                    return@runCatching
                }
                AppRainier.showSurvey(eventName, activity, surveyCallback())
                promise.resolve(true)
            }.onFailure { promise.reject("APPRAINIER_SHOW_SURVEY_FAILED", it) }
        }
    }

    @ReactMethod
    fun refreshAnnouncements(force: Boolean, promise: Promise) {
        runCatching {
            AppRainier.refreshAnnouncements(force)
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_REFRESH_ANNOUNCEMENTS_FAILED", it) }
    }

    @ReactMethod
    fun canShowAnnouncement(eventName: String, promise: Promise) {
        runCatching { promise.resolve(AppRainier.canShowAnnouncement(eventName)) }
            .onFailure { promise.reject("APPRAINIER_CAN_SHOW_ANNOUNCEMENT_FAILED", it) }
    }

    @ReactMethod
    fun showAnnouncement(eventName: String, promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("APPRAINIER_NO_ACTIVITY", "No foreground Activity is available.")
            return
        }
        UiThreadUtil.runOnUiThread {
            runCatching {
                if (!AppRainier.canShowAnnouncement(eventName)) {
                    promise.resolve(false)
                    return@runCatching
                }
                AppRainier.showAnnouncement(eventName, activity, announcementCallback())
                promise.resolve(true)
            }.onFailure { promise.reject("APPRAINIER_SHOW_ANNOUNCEMENT_FAILED", it) }
        }
    }

    @ReactMethod
    fun refreshLiveCards(force: Boolean, promise: Promise) {
        runCatching {
            AppRainier.refreshLiveCards(force) { didRefresh -> promise.resolve(didRefresh) }
        }.onFailure { promise.reject("APPRAINIER_REFRESH_LIVE_CARDS_FAILED", it) }
    }

    @ReactMethod
    fun hasLiveCard(triggerId: String, promise: Promise) {
        runCatching {
            AppRainier.hasLiveCard(triggerId) { hasCard -> promise.resolve(hasCard) }
        }.onFailure { promise.reject("APPRAINIER_HAS_LIVE_CARD_FAILED", it) }
    }

    @ReactMethod
    fun refreshMessageCenter(promise: Promise) {
        runCatching {
            AppRainier.refreshAnnouncements(true)
            AppRainier.getUnreadMessageCount { promise.resolve(true) }
        }.onFailure { promise.reject("APPRAINIER_REFRESH_MESSAGE_CENTER_FAILED", it) }
    }

    @ReactMethod
    fun openMessageCenter(
        initialTab: String?,
        announcementId: String?,
        threadId: String?,
        promise: Promise
    ) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("APPRAINIER_NO_ACTIVITY", "No foreground Activity is available.")
            return
        }
        runCatching {
            AppRainier.getUnreadMessageCount {
                UiThreadUtil.runOnUiThread {
                    runCatching {
                        if (!AppRainier.canShowMessageCenter()) {
                            promise.resolve(false)
                            return@runCatching
                        }
                        AppRainier.openMessageCenter(
                            activity = activity,
                            initialTab = initialTab?.takeIf { it.isNotBlank() },
                            announcementId = announcementId?.takeIf { it.isNotBlank() },
                            threadId = threadId?.takeIf { it.isNotBlank() },
                        )
                        promise.resolve(true)
                    }.onFailure { promise.reject("APPRAINIER_OPEN_MESSAGE_CENTER_FAILED", it) }
                }
            }
        }.onFailure { promise.reject("APPRAINIER_OPEN_MESSAGE_CENTER_FAILED", it) }
    }

    @ReactMethod
    fun getUnreadMessageCount(promise: Promise) {
        runCatching {
            AppRainier.getUnreadMessageCount { count -> promise.resolve(count) }
        }.onFailure { promise.reject("APPRAINIER_UNREAD_COUNT_FAILED", it) }
    }

    @ReactMethod
    fun onPushTokenRefreshed(token: String, promise: Promise) {
        runCatching {
            AppRainier.onPushTokenRefreshed(reactContext.applicationContext, token)
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_PUSH_TOKEN_FAILED", it) }
    }

    @ReactMethod
    fun isAppRainierPush(data: ReadableMap, promise: Promise) {
        runCatching { promise.resolve(AppRainier.isAppRainierPush(readableMapToStringMap(data))) }
            .onFailure { promise.reject("APPRAINIER_PUSH_CHECK_FAILED", it) }
    }

    @ReactMethod
    fun handlePushMessage(
        data: ReadableMap,
        notificationTitle: String?,
        notificationBody: String?,
        promise: Promise
    ) {
        runCatching {
            val handled = AppRainier.handlePushMessage(
                reactContext.applicationContext,
                readableMapToStringMap(data),
                notificationTitle,
                notificationBody
            )
            promise.resolve(handled)
        }.onFailure { promise.reject("APPRAINIER_HANDLE_PUSH_FAILED", it) }
    }

    @ReactMethod
    fun getUserId(promise: Promise) {
        runCatching { promise.resolve(AppRainier.getUserId()) }
            .onFailure { promise.reject("APPRAINIER_GET_USER_ID_FAILED", it) }
    }

    @ReactMethod
    fun getUserDebugState(promise: Promise) {
        runCatching {
            promise.resolve(jsonObjectToWritableMap(gson.toJson(AppRainier.getUserDebugState())))
        }.onFailure { promise.reject("APPRAINIER_GET_DEBUG_STATE_FAILED", it) }
    }

    @ReactMethod
    fun flush(promise: Promise) {
        runCatching {
            AppRainier.flush()
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_FLUSH_FAILED", it) }
    }

    @ReactMethod
    fun shutdown(promise: Promise) {
        runCatching {
            AppRainier.shutdown()
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_SHUTDOWN_FAILED", it) }
    }

    private fun setProperty(promise: Promise, block: () -> Unit) {
        runCatching {
            block()
            promise.resolve(true)
        }.onFailure { promise.reject("APPRAINIER_SET_PROPERTY_FAILED", it) }
    }

    private fun surveyCallback(): SurveyCallback {
        return object : SurveyCallback {
            override fun onSurveySubmitted(
                surveyId: String,
                responses: Map<String, Any>,
                targetScreen: String?,
                deepLink: String?
            ) {
                emitEvent("AppRainierSurveySubmitted", Arguments.createMap().apply {
                    putString("surveyId", surveyId)
                    putMap("responses", mapToWritableMap(responses))
                    putString("targetScreen", targetScreen)
                    putString("deepLink", deepLink)
                })
            }

            override fun onSurveyCancelled(surveyId: String, targetScreen: String?, deepLink: String?) {
                emitEvent("AppRainierSurveyCancelled", Arguments.createMap().apply {
                    putString("surveyId", surveyId)
                    putString("targetScreen", targetScreen)
                    putString("deepLink", deepLink)
                })
            }

            override fun onSurveyDismissed(surveyId: String) {
                if (surveyId.isBlank()) return
                emitEvent("AppRainierSurveyDismissed", Arguments.createMap().apply {
                    putString("surveyId", surveyId)
                })
            }
        }
    }

    private fun announcementCallback(): AnnouncementCallback {
        return object : AnnouncementCallback {
            override fun onAnnouncementSubmitted(
                announcementId: String,
                responses: Map<String, Any>,
                targetScreen: String?,
                deepLink: String?
            ) {
                emitEvent("AppRainierAnnouncementSubmitted", Arguments.createMap().apply {
                    putString("announcementId", announcementId)
                    putMap("responses", mapToWritableMap(responses))
                    putString("targetScreen", targetScreen)
                    putString("deepLink", deepLink)
                })
            }

            override fun onAnnouncementCancelled(
                announcementId: String,
                targetScreen: String?,
                deepLink: String?
            ) {
                emitEvent("AppRainierAnnouncementCancelled", Arguments.createMap().apply {
                    putString("announcementId", announcementId)
                    putString("targetScreen", targetScreen)
                    putString("deepLink", deepLink)
                })
            }

            override fun onAnnouncementDismissed(announcementId: String) {
                if (announcementId.isBlank()) return
                emitEvent("AppRainierAnnouncementDismissed", Arguments.createMap().apply {
                    putString("announcementId", announcementId)
                })
            }
        }
    }

    private fun emitEvent(name: String, payload: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(name, payload)
    }

    private fun readableMapToStringMap(map: ReadableMap?): Map<String, String> {
        return readableMapToMap(map).mapValues { it.value.toString() }
    }

    private fun readableMapToMap(map: ReadableMap?): Map<String, Any> {
        if (map == null) return emptyMap()
        val result = mutableMapOf<String, Any>()
        val iterator = map.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            when (map.getType(key)) {
                ReadableType.Null -> Unit
                ReadableType.Boolean -> result[key] = map.getBoolean(key)
                ReadableType.Number -> result[key] = map.getDouble(key)
                ReadableType.String -> result[key] = map.getString(key) ?: ""
                ReadableType.Map -> result[key] = readableMapToMap(map.getMap(key))
                ReadableType.Array -> result[key] = readableArrayToList(map.getArray(key))
            }
        }
        return result
    }

    private fun readableArrayToList(array: ReadableArray?): List<Any> {
        if (array == null) return emptyList()
        val result = mutableListOf<Any>()
        for (index in 0 until array.size()) {
            when (array.getType(index)) {
                ReadableType.Null -> Unit
                ReadableType.Boolean -> result.add(array.getBoolean(index))
                ReadableType.Number -> result.add(array.getDouble(index))
                ReadableType.String -> result.add(array.getString(index) ?: "")
                ReadableType.Map -> result.add(readableMapToMap(array.getMap(index)))
                ReadableType.Array -> result.add(readableArrayToList(array.getArray(index)))
            }
        }
        return result
    }

    private fun dynamicToAny(value: Dynamic): Any? {
        return when (value.type) {
            ReadableType.Null -> null
            ReadableType.Boolean -> value.asBoolean()
            ReadableType.Number -> value.asDouble()
            ReadableType.String -> value.asString()
            ReadableType.Map -> readableMapToMap(value.asMap())
            ReadableType.Array -> readableArrayToList(value.asArray())
        }
    }

    private fun toPromiseValue(value: Any?): Any? {
        return when (value) {
            is Map<*, *> -> mapToWritableMap(value.entries.associate { it.key.toString() to it.value })
            is List<*> -> listToWritableArray(value)
            else -> value
        }
    }

    private fun mapToWritableMap(map: Map<String, Any?>): WritableMap {
        return Arguments.createMap().apply {
            for ((key, value) in map) {
                putWritableValue(key, value)
            }
        }
    }

    private fun listToWritableArray(list: List<*>): WritableArray {
        return Arguments.createArray().apply {
            for (value in list) {
                pushWritableValue(value)
            }
        }
    }

    private fun WritableMap.putWritableValue(key: String, value: Any?) {
        when (value) {
            null -> putNull(key)
            is Boolean -> putBoolean(key, value)
            is Int -> putInt(key, value)
            is Long -> putDouble(key, value.toDouble())
            is Float -> putDouble(key, value.toDouble())
            is Double -> putDouble(key, value)
            is String -> putString(key, value)
            is Map<*, *> -> putMap(key, mapToWritableMap(value.entries.associate { it.key.toString() to it.value }))
            is List<*> -> putArray(key, listToWritableArray(value))
            else -> putString(key, value.toString())
        }
    }

    private fun WritableArray.pushWritableValue(value: Any?) {
        when (value) {
            null -> pushNull()
            is Boolean -> pushBoolean(value)
            is Int -> pushInt(value)
            is Long -> pushDouble(value.toDouble())
            is Float -> pushDouble(value.toDouble())
            is Double -> pushDouble(value)
            is String -> pushString(value)
            is Map<*, *> -> pushMap(mapToWritableMap(value.entries.associate { it.key.toString() to it.value }))
            is List<*> -> pushArray(listToWritableArray(value))
            else -> pushString(value.toString())
        }
    }

    private fun jsonObjectToWritableMap(json: String): WritableMap? {
        if (json == "null") return null
        return jsonValueToWritable(JSONObject(json)) as? WritableMap
    }

    private fun jsonValueToWritable(value: Any?): Any? {
        return when (value) {
            null, JSONObject.NULL -> null
            is JSONObject -> Arguments.createMap().apply {
                value.keys().forEach { key -> putWritableValue(key, jsonValueToWritable(value.get(key))) }
            }
            is JSONArray -> Arguments.createArray().apply {
                for (index in 0 until value.length()) {
                    pushWritableValue(jsonValueToWritable(value.get(index)))
                }
            }
            else -> value
        }
    }

    companion object {
        private const val MODULE_NAME = "AppRainierReactNativePlugin"
    }
}
