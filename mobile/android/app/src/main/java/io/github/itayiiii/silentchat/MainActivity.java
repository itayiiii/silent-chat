package io.github.itayiiii.silentchat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own small plugin: keeps the microphone on during a conversation (see CallService)
        registerPlugin(SilentCallPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
