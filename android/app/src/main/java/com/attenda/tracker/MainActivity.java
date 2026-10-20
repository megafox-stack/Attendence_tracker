package com.attenda.tracker;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // This resource is true only in the debug source set, so release builds
        // keep WebView's default mixed-content protections.
        if (getResources().getBoolean(R.bool.allow_local_api_http) && bridge != null) {
            bridge.getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }
}
