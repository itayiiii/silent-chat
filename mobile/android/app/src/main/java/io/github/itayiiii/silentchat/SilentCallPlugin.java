package io.github.itayiiii.silentchat;

import android.Manifest;
import android.content.ActivityNotFoundException;
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
 * Also sends an invitation: Capacitor.nativePromise('SilentCall', 'share', { text, title, app })
 * (app: 'whatsapp' = straight into WhatsApp; otherwise / without WhatsApp = Android's share sheet)
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

    /** "שלח הזמנה בוואטסאפ" / "בדרך אחרת": the invitation with the room's link, into WhatsApp or the share sheet. */
    @PluginMethod
    public void share(PluginCall call) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
        if ("whatsapp".equals(call.getString("app"))) {
            for (String pkg : new String[] { "com.whatsapp", "com.whatsapp.w4b" }) {   // WhatsApp, WhatsApp Business
                try {
                    getActivity().startActivity(new Intent(send).setPackage(pkg));
                    call.resolve();
                    return;
                } catch (ActivityNotFoundException e) {
                    // not installed: try the next one, then the share sheet
                }
            }
        }
        try {
            getActivity().startActivity(Intent.createChooser(send, call.getString("title", "")));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the share sheet: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopService();
    }

    private void stopService() {
        getContext().stopService(new Intent(getContext(), CallService.class));
    }
}
