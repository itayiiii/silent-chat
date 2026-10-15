package io.github.itayiiii.silentchat;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Lets the web page turn the "conversation active" service on and off.
 * From the page: Capacitor.nativePromise('SilentCall', 'start' | 'stop', {})
 */
@CapacitorPlugin(
    name = "SilentCall",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class SilentCallPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        // Android 13+: ask once to show the "conversation active" notification.
        // The service works either way; without permission the notification is just hidden.
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "afterNotificationQuestion");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void afterNotificationQuestion(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), CallService.class));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start the conversation service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopService();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopService();
    }

    private void stopService() {
        getContext().stopService(new Intent(getContext(), CallService.class));
    }
}
