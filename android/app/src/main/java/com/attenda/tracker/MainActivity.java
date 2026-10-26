package com.attenda.tracker;

import android.os.Bundle;
import android.content.Intent;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;
import com.attenda.tracker.local.LocalAttendancePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalAttendancePlugin.class);
        super.onCreate(savedInstanceState);

        // This resource is true only in the debug source set, so release builds
        // keep WebView's default mixed-content protections.
        if (getResources().getBoolean(R.bool.allow_local_api_http) && bridge != null) {
            bridge.getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        dispatchNotificationRoute(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchNotificationRoute(intent);
    }

    private void dispatchNotificationRoute(Intent intent) {
        if (intent == null || !intent.hasExtra("notificationRoute") || bridge == null) return;
        String route = intent.getStringExtra("notificationRoute");
        intent.removeExtra("notificationRoute");
        if (route == null || !route.startsWith("/")) return;
        final int[] attempts = {0};
        Runnable dispatch = new Runnable() {
            @Override public void run() {
                if (bridge == null || bridge.getWebView() == null || attempts[0]++ > 40) return;
                bridge.getWebView().evaluateJavascript("(function(){if(!document.getElementById('root')?.children.length)return false;window.dispatchEvent(new CustomEvent('attenda:notification-open',{detail:{path:" + org.json.JSONObject.quote(route) + "}}));return true;})()", value -> {
                    if ("false".equals(value)) bridge.getWebView().postDelayed(this, 300);
                });
            }
        };
        bridge.getWebView().postDelayed(dispatch, 300);
    }
}
