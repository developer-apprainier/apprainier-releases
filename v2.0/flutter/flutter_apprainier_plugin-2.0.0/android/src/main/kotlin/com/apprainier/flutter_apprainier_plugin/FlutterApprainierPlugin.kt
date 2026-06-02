package com.apprainier.flutter_apprainier_plugin

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.View
import android.widget.FrameLayout
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.apprainier.sdk.core.AnnouncementCallback
import com.apprainier.sdk.core.AppRainier
import com.apprainier.sdk.core.AppRainierSdkConfig
import com.apprainier.sdk.core.Environment
import com.apprainier.sdk.core.SDKState
import com.apprainier.sdk.core.SurveyCallback
import com.apprainier.sdk.data.models.livecards.LiveCard
import com.apprainier.sdk.ui.livecards.LiveCardView
import com.google.gson.Gson
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.MethodChannel.MethodCallHandler
import io.flutter.plugin.common.MethodChannel.Result
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

class FlutterApprainierPlugin :
    FlutterPlugin,
    ActivityAware,
    MethodCallHandler,
    EventChannel.StreamHandler {
    private lateinit var appContext: Context
    private lateinit var channel: MethodChannel
    private lateinit var eventChannel: EventChannel
    private var activity: Activity? = null
    private var events: EventChannel.EventSink? = null
    private val gson = Gson()

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        appContext = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, METHOD_CHANNEL)
        eventChannel = EventChannel(binding.binaryMessenger, EVENT_CHANNEL)
        channel.setMethodCallHandler(this)
        eventChannel.setStreamHandler(this)
        binding.platformViewRegistry.registerViewFactory(
            LIVE_CARD_VIEW_TYPE,
            AppRainierLiveCardViewFactory(binding.binaryMessenger)
        )
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
        eventChannel.setStreamHandler(null)
        events = null
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivity() {
        activity = null
    }

    override fun onListen(arguments: Any?, sink: EventChannel.EventSink) {
        events = sink
    }

    override fun onCancel(arguments: Any?) {
        events = null
    }

    override fun onMethodCall(call: MethodCall, result: Result) {
        when (call.method) {
            "initialize" -> initialize(call, result)
            "initializeWithConfig" -> initializeWithConfig(call, result)
            "identify" -> wrap(result, "APPRAINIER_IDENTIFY_FAILED") {
                AppRainier.identify(call.requiredString("userId"), call.mapArg("traits"))
                result.success(true)
            }
            "resetUser" -> wrap(result, "APPRAINIER_RESET_USER_FAILED") {
                AppRainier.resetUser(call.stringArg("reason") ?: "manual_reset")
                result.success(true)
            }
            "setUserProfile" -> setUserProfile(call, result)
            "setUserProperty" -> setProperty(call, result) { key, value -> AppRainier.setUserProperty(key, value ?: "") }
            "setAppProperty" -> setProperty(call, result) { key, value -> AppRainier.setAppProperty(key, value ?: "") }
            "setDeviceProperty" -> setProperty(call, result) { key, value -> AppRainier.setDeviceProperty(key, value ?: "") }
            "setCustomProperty" -> setProperty(call, result) { key, value -> AppRainier.setCustomProperty(key, value ?: "") }
            "setUserType" -> wrap(result, "APPRAINIER_SET_USER_TYPE_FAILED") {
                AppRainier.setUserType(call.requiredString("userType"))
                result.success(true)
            }
            "refreshFeatureFlags" -> wrap(result, "APPRAINIER_REFRESH_FLAGS_FAILED") {
                AppRainier.refreshFeatureFlags(call.boolArg("force"))
                result.success(true)
            }
            "getFeatureFlag" -> wrap(result, "APPRAINIER_GET_FLAG_FAILED") {
                result.success(toMethodValue(AppRainier.getFeatureFlag(call.requiredString("flagKey"), call.argument<Any?>("defaultValue") ?: false)))
            }
            "getExperimentVariation" -> wrap(result, "APPRAINIER_GET_EXPERIMENT_VARIATION_FAILED") {
                result.success(jsonObjectToMap(gson.toJson(AppRainier.getExperimentVariation(call.requiredString("flagKey")))))
            }
            "getExperimentConfig" -> wrap(result, "APPRAINIER_GET_EXPERIMENT_CONFIG_FAILED") {
                result.success(jsonObjectToMap(gson.toJson(AppRainier.getExperimentConfig(call.requiredString("flagKey")))))
            }
            "trackExperimentExposure" -> wrap(result, "APPRAINIER_TRACK_EXPOSURE_FAILED") {
                AppRainier.trackExperimentExposure(call.requiredString("flagKey"), call.mapArg("context"))
                result.success(true)
            }
            "trackExperimentConversion" -> wrap(result, "APPRAINIER_TRACK_CONVERSION_FAILED") {
                AppRainier.trackExperimentConversion(
                    flagKey = call.requiredString("flagKey"),
                    goalId = call.stringArg("goalId"),
                    value = call.argument<Any?>("value"),
                    context = call.mapArg("context")
                )
                result.success(true)
            }
            "trackEvent" -> wrap(result, "APPRAINIER_TRACK_EVENT_FAILED") {
                AppRainier.trackEvent(call.requiredString("eventName"), call.mapArg("properties"), call.stringArg("eventType") ?: "custom")
                result.success(true)
            }
            "refreshSurveys" -> wrap(result, "APPRAINIER_REFRESH_SURVEYS_FAILED") {
                AppRainier.refreshSurveys(call.boolArg("force"))
                result.success(true)
            }
            "canShowSurvey" -> wrap(result, "APPRAINIER_CAN_SHOW_SURVEY_FAILED") {
                result.success(AppRainier.canShowSurvey(call.requiredString("eventName")))
            }
            "showSurvey" -> showSurvey(call, result)
            "refreshAnnouncements" -> wrap(result, "APPRAINIER_REFRESH_ANNOUNCEMENTS_FAILED") {
                AppRainier.refreshAnnouncements(call.boolArg("force"))
                result.success(true)
            }
            "canShowAnnouncement" -> wrap(result, "APPRAINIER_CAN_SHOW_ANNOUNCEMENT_FAILED") {
                result.success(AppRainier.canShowAnnouncement(call.requiredString("eventName")))
            }
            "showAnnouncement" -> showAnnouncement(call, result)
            "refreshLiveCards" -> wrap(result, "APPRAINIER_REFRESH_LIVE_CARDS_FAILED") {
                AppRainier.refreshLiveCards(call.boolArg("force", true)) { didRefresh -> result.success(didRefresh) }
            }
            "hasLiveCard" -> wrap(result, "APPRAINIER_HAS_LIVE_CARD_FAILED") {
                AppRainier.hasLiveCard(call.requiredString("triggerId")) { hasCard -> result.success(hasCard) }
            }
            "refreshMessageCenter" -> wrap(result, "APPRAINIER_REFRESH_MESSAGE_CENTER_FAILED") {
                AppRainier.refreshAnnouncements(true)
                AppRainier.getUnreadMessageCount { result.success(true) }
            }
            "openMessageCenter" -> openMessageCenter(call, result)
            "getUnreadMessageCount" -> wrap(result, "APPRAINIER_UNREAD_COUNT_FAILED") {
                AppRainier.getUnreadMessageCount { count -> result.success(count) }
            }
            "onPushTokenRefreshed" -> wrap(result, "APPRAINIER_PUSH_TOKEN_FAILED") {
                AppRainier.onPushTokenRefreshed(appContext, call.requiredString("token"))
                result.success(true)
            }
            "isAppRainierPush" -> wrap(result, "APPRAINIER_PUSH_CHECK_FAILED") {
                result.success(AppRainier.isAppRainierPush(call.stringMapArg("payload")))
            }
            "handlePushMessage" -> wrap(result, "APPRAINIER_HANDLE_PUSH_FAILED") {
                result.success(
                    AppRainier.handlePushMessage(
                        appContext,
                        call.stringMapArg("payload"),
                        call.stringArg("notificationTitle"),
                        call.stringArg("notificationBody")
                    )
                )
            }
            "getUserId" -> wrap(result, "APPRAINIER_GET_USER_ID_FAILED") {
                result.success(AppRainier.getUserId())
            }
            "getUserDebugState" -> wrap(result, "APPRAINIER_GET_DEBUG_STATE_FAILED") {
                result.success(jsonObjectToMap(gson.toJson(AppRainier.getUserDebugState())))
            }
            "flush" -> wrap(result, "APPRAINIER_FLUSH_FAILED") {
                AppRainier.flush()
                result.success(true)
            }
            "shutdown" -> wrap(result, "APPRAINIER_SHUTDOWN_FAILED") {
                AppRainier.shutdown()
                result.success(true)
            }
            else -> result.notImplemented()
        }
    }

    private fun initialize(call: MethodCall, result: Result) {
        val didResolve = AtomicBoolean(false)
        wrap(result, "APPRAINIER_INITIALIZE_FAILED") {
            AppRainier.initialize(
                appContext,
                call.requiredString("apiKey"),
                Environment.fromValue(call.requiredString("environment"))
            ) { state ->
                resolveInitializationState(state, didResolve, result)
            }
        }
    }

    private fun initializeWithConfig(call: MethodCall, result: Result) {
        val didResolve = AtomicBoolean(false)
        wrap(result, "APPRAINIER_INITIALIZE_FAILED") {
            val config = AppRainierSdkConfig.fromJson(gson.toJson(call.mapArg("config")))
            AppRainier.initialize(appContext, config) { state ->
                resolveInitializationState(state, didResolve, result)
            }
        }
    }

    private fun resolveInitializationState(
        state: SDKState,
        didResolve: AtomicBoolean,
        result: Result
    ) {
        when (state) {
            SDKState.READY -> {
                if (didResolve.compareAndSet(false, true)) {
                    result.success("ready")
                }
            }
            SDKState.SHUTDOWN -> {
                if (didResolve.compareAndSet(false, true)) {
                    result.success("shutdown")
                }
            }
            is SDKState.ERROR -> {
                if (didResolve.compareAndSet(false, true)) {
                    result.error(
                        "APPRAINIER_INITIALIZE_FAILED",
                        state.error.message ?: state.toString(),
                        null
                    )
                }
            }
            else -> Unit
        }
    }

    private fun setUserProfile(call: MethodCall, result: Result) {
        wrap(result, "APPRAINIER_SET_USER_PROFILE_FAILED") {
            AppRainier.setUserProfile(
                userId = call.requiredString("userId"),
                userType = call.requiredString("userType"),
                userProperties = call.mapArg("userProperties"),
                appProperties = call.mapArg("appProperties"),
                deviceProperties = call.mapArg("deviceProperties"),
                customProperties = call.mapArg("customProperties")
            )
            result.success(true)
        }
    }

    private fun setProperty(call: MethodCall, result: Result, block: (String, Any?) -> Unit) {
        wrap(result, "APPRAINIER_SET_PROPERTY_FAILED") {
            block(call.requiredString("key"), call.argument<Any?>("value"))
            result.success(true)
        }
    }

    private fun showSurvey(call: MethodCall, result: Result) {
        val currentActivity = activity
        if (currentActivity == null) {
            result.error("APPRAINIER_NO_ACTIVITY", "No foreground Activity is available.", null)
            return
        }
        if (!ensureComposeHostOwners(currentActivity, result)) return
        val eventName = call.requiredString("eventName")
        if (!AppRainier.canShowSurvey(eventName)) {
            result.success(false)
            return
        }
        currentActivity.runOnUiThread {
            wrap(result, "APPRAINIER_SHOW_SURVEY_FAILED") {
                AppRainier.showSurvey(eventName, currentActivity, surveyCallback())
                result.success(true)
            }
        }
    }

    private fun showAnnouncement(call: MethodCall, result: Result) {
        val currentActivity = activity
        if (currentActivity == null) {
            result.error("APPRAINIER_NO_ACTIVITY", "No foreground Activity is available.", null)
            return
        }
        if (!ensureComposeHostOwners(currentActivity, result)) return
        val eventName = call.requiredString("eventName")
        if (!AppRainier.canShowAnnouncement(eventName)) {
            result.success(false)
            return
        }
        currentActivity.runOnUiThread {
            wrap(result, "APPRAINIER_SHOW_ANNOUNCEMENT_FAILED") {
                AppRainier.showAnnouncement(eventName, currentActivity, announcementCallback())
                result.success(true)
            }
        }
    }

    private fun openMessageCenter(call: MethodCall, result: Result) {
        val currentActivity = activity
        if (currentActivity == null) {
            result.error("APPRAINIER_NO_ACTIVITY", "No foreground Activity is available.", null)
            return
        }
        wrap(result, "APPRAINIER_OPEN_MESSAGE_CENTER_FAILED") {
            AppRainier.getUnreadMessageCount {
                currentActivity.runOnUiThread {
                    wrap(result, "APPRAINIER_OPEN_MESSAGE_CENTER_FAILED") {
                        if (!AppRainier.canShowMessageCenter()) {
                            result.success(false)
                            return@wrap
                        }
                        AppRainier.openMessageCenter(
                            activity = currentActivity,
                            initialTab = call.stringArg("initialTab")?.takeIf { it.isNotBlank() },
                            announcementId = call.stringArg("announcementId")?.takeIf { it.isNotBlank() },
                            threadId = call.stringArg("threadId")?.takeIf { it.isNotBlank() }
                        )
                        result.success(true)
                    }
                }
            }
        }
    }

    private fun surveyCallback(): SurveyCallback {
        return object : SurveyCallback {
            override fun onSurveySubmitted(
                surveyId: String,
                responses: Map<String, Any>,
                targetScreen: String?,
                deepLink: String?
            ) {
                emitEvent(
                    "AppRainierSurveySubmitted",
                    mapOf(
                        "surveyId" to surveyId,
                        "responses" to responses,
                        "targetScreen" to targetScreen,
                        "deepLink" to deepLink
                    )
                )
            }

            override fun onSurveyCancelled(surveyId: String, targetScreen: String?, deepLink: String?) {
                emitEvent(
                    "AppRainierSurveyCancelled",
                    mapOf("surveyId" to surveyId, "targetScreen" to targetScreen, "deepLink" to deepLink)
                )
            }

            override fun onSurveyDismissed(surveyId: String) {
                if (surveyId.isBlank()) return
                emitEvent("AppRainierSurveyDismissed", mapOf("surveyId" to surveyId))
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
                emitEvent(
                    "AppRainierAnnouncementSubmitted",
                    mapOf(
                        "announcementId" to announcementId,
                        "responses" to responses,
                        "targetScreen" to targetScreen,
                        "deepLink" to deepLink
                    )
                )
            }

            override fun onAnnouncementCancelled(announcementId: String, targetScreen: String?, deepLink: String?) {
                emitEvent(
                    "AppRainierAnnouncementCancelled",
                    mapOf("announcementId" to announcementId, "targetScreen" to targetScreen, "deepLink" to deepLink)
                )
            }

            override fun onAnnouncementDismissed(announcementId: String) {
                if (announcementId.isBlank()) return
                emitEvent("AppRainierAnnouncementDismissed", mapOf("announcementId" to announcementId))
            }
        }
    }

    private fun emitEvent(name: String, payload: Map<String, Any?>) {
        activity?.runOnUiThread {
            events?.success(mapOf("name" to name, "payload" to toMethodValue(payload)))
        }
    }

    private fun ensureComposeHostOwners(currentActivity: Activity, result: Result): Boolean {
        val lifecycleOwner = currentActivity as? LifecycleOwner
        val savedStateOwner = currentActivity as? SavedStateRegistryOwner
        val viewModelStoreOwner = currentActivity as? ViewModelStoreOwner

        if (lifecycleOwner == null || savedStateOwner == null || viewModelStoreOwner == null) {
            result.error(
                "APPRAINIER_INVALID_ACTIVITY",
                "AppRainier Android UI uses Jetpack Compose. Change your Flutter host activity to extend FlutterFragmentActivity instead of FlutterActivity.",
                null
            )
            return false
        }

        currentActivity.window.decorView.setViewTreeLifecycleOwner(lifecycleOwner)
        currentActivity.window.decorView.setViewTreeSavedStateRegistryOwner(savedStateOwner)
        currentActivity.window.decorView.setViewTreeViewModelStoreOwner(viewModelStoreOwner)
        return true
    }

    private fun wrap(result: Result, code: String, block: () -> Unit) {
        runCatching(block).onFailure {
            result.error(code, it.message, null)
        }
    }

    private fun MethodCall.requiredString(key: String): String {
        return stringArg(key)?.trim()?.takeIf { it.isNotEmpty() }
            ?: throw IllegalArgumentException("$key must be a non-empty string.")
    }

    private fun MethodCall.stringArg(key: String): String? = argument<String?>(key)

    private fun MethodCall.boolArg(key: String, fallback: Boolean = false): Boolean = argument<Boolean?>(key) ?: fallback

    @Suppress("UNCHECKED_CAST")
    private fun MethodCall.mapArg(key: String): Map<String, Any> {
        val value = argument<Map<*, *>?>(key) ?: return emptyMap()
        return value.entries.mapNotNull { entry ->
            val mapKey = entry.key?.toString() ?: return@mapNotNull null
            val mapValue = entry.value ?: return@mapNotNull null
            mapKey to mapValue
        }.toMap()
    }

    private fun MethodCall.stringMapArg(key: String): Map<String, String> {
        return mapArg(key).mapValues { it.value.toString() }
    }

    private fun toMethodValue(value: Any?): Any? {
        return when (value) {
            null -> null
            is Boolean, is Int, is Long, is Float, is Double, is String -> value
            is Map<*, *> -> value.entries.associate { it.key.toString() to toMethodValue(it.value) }
            is List<*> -> value.map { toMethodValue(it) }
            else -> value.toString()
        }
    }

    private fun jsonObjectToMap(json: String): Map<String, Any?>? {
        if (json == "null") return null
        return jsonValueToMethodValue(JSONObject(json)) as? Map<String, Any?>
    }

    private fun jsonValueToMethodValue(value: Any?): Any? {
        return when (value) {
            null, JSONObject.NULL -> null
            is JSONObject -> value.keys().asSequence().associateWith { key -> jsonValueToMethodValue(value.get(key)) }
            is JSONArray -> (0 until value.length()).map { jsonValueToMethodValue(value.get(it)) }
            else -> value
        }
    }

    companion object {
        private const val METHOD_CHANNEL = "flutter_apprainier_plugin"
        private const val EVENT_CHANNEL = "flutter_apprainier_plugin/events"
        private const val LIVE_CARD_VIEW_TYPE = "flutter_apprainier_plugin/live_card"
    }
}

private class AppRainierLiveCardViewFactory(
    private val messenger: BinaryMessenger
) : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    override fun create(context: Context, id: Int, args: Any?): PlatformView {
        @Suppress("UNCHECKED_CAST")
        val params = args as? Map<String, Any?> ?: emptyMap()
        return AppRainierLiveCardPlatformView(context, messenger, id, params)
    }
}

private class AppRainierLiveCardPlatformView(
    context: Context,
    messenger: BinaryMessenger,
    id: Int,
    params: Map<String, Any?>
) : PlatformView {
    private val container = FrameLayout(context)
    private val channel = MethodChannel(messenger, "flutter_apprainier_plugin/live_card_$id")
    private var triggerId = params["triggerId"] as? String
    private var loadToken = 0
    private var pendingReload = true

    init {
        installComposeOwners(container, context)
        container.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {
                container.post { flushPendingReload() }
            }

            override fun onViewDetachedFromWindow(v: View) = Unit
        })
        container.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            if (container.width > 0) {
                container.post { flushPendingReload() }
            }
        }
        reload()
    }

    override fun getView(): View = container

    override fun dispose() {
        loadToken += 1
        container.removeAllViews()
        channel.setMethodCallHandler(null)
    }

    private fun reload() {
        if (!container.isAttachedToWindow || container.width == 0) {
            pendingReload = true
            return
        }

        val currentTriggerId = triggerId?.trim()?.takeIf { it.isNotEmpty() }
        container.removeAllViews()
        if (currentTriggerId == null) return

        pendingReload = false
        val token = ++loadToken
        runCatching {
            AppRainier.createLiveCardView(currentTriggerId, container.context) { liveCardView ->
                container.post {
                    if (token != loadToken || triggerId?.trim() != currentTriggerId) return@post
                    container.removeAllViews()

                    if (liveCardView == null) {
                        emit("onCardUnavailable", mapOf("triggerId" to currentTriggerId))
                        return@post
                    }

                    installComposeOwners(liveCardView, container.context)

                    liveCardView.setOnLiveCardClickListener(object : LiveCardView.OnLiveCardClickListener {
                        override fun onLiveCardClicked(
                            card: LiveCard,
                            buttonType: String?,
                            carouselItemIndex: Int?
                        ) {
                            emitClick(card, buttonType, carouselItemIndex)
                        }

                        override fun onLiveCardDismissed(card: LiveCard) = Unit
                    })

                    container.addView(
                        liveCardView,
                        FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT
                        )
                    )
                    container.post {
                        liveCardView.getLiveCard()?.let { card -> liveCardView.setLiveCard(card) }
                        liveCardView.requestLayout()
                        liveCardView.invalidate()
                        container.postDelayed({
                            emit("onCardReady", mapOf("triggerId" to currentTriggerId))
                        }, 120L)
                    }
                }
            }
        }.onFailure {
            emit("onCardUnavailable", mapOf("triggerId" to currentTriggerId))
        }
    }

    private fun flushPendingReload() {
        if (pendingReload && container.isAttachedToWindow && container.width > 0) {
            reload()
        }
    }

    private fun emitClick(card: LiveCard, buttonType: String?, carouselItemIndex: Int?) {
        val actionTarget = if (carouselItemIndex != null) {
            card.structure?.carouselItems?.getOrNull(carouselItemIndex)?.deepLink
                ?: card.structure?.carouselItems?.getOrNull(carouselItemIndex)?.action?.target
                ?: card.deepLink
        } else {
            card.structure?.deepLink ?: card.deepLink
        }
        emit(
            "onCardClick",
            mapOf(
                "triggerId" to triggerId,
                "liveCardId" to card.id,
                "liveCardName" to card.name,
                "buttonType" to buttonType,
                "actionType" to "deeplink",
                "actionTarget" to actionTarget,
                "carouselItemIndex" to carouselItemIndex
            )
        )
    }

    private fun emit(method: String, payload: Map<String, Any?>) {
        channel.invokeMethod(method, payload.filterValues { it != null })
    }

    private fun installComposeOwners(view: View, context: Context) {
        val activity = context.findActivity()
        val lifecycleOwner = activity as? LifecycleOwner
        val savedStateOwner = activity as? SavedStateRegistryOwner
        val viewModelStoreOwner = activity as? ViewModelStoreOwner

        if (lifecycleOwner != null) view.setViewTreeLifecycleOwner(lifecycleOwner)
        if (savedStateOwner != null) view.setViewTreeSavedStateRegistryOwner(savedStateOwner)
        if (viewModelStoreOwner != null) view.setViewTreeViewModelStoreOwner(viewModelStoreOwner)
    }
}

private tailrec fun Context.findActivity(): Activity? {
    return when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }
}
