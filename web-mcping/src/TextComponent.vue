<script setup lang="ts">
import { getSuggestedStyle, TextComponent } from '@createlumina/text-component';
import { computed, ComputedRef, defineProps } from 'vue'

const props = defineProps<{
    data: TextComponent
}>();

interface RenderNode {
    text: string;
    style: Record<string, string>;
}

function render(root: TextComponent, outList: RenderNode[]) {
    let e = {
        text: root.text,
        style: getSuggestedStyle(root)
    } as RenderNode;
    outList.push(e);
    if (root.extra) {
        for (let child of root.extra) {
            render(child, outList);
        }
    }
}

const nodes: ComputedRef<RenderNode[]> = computed(() => {
    let flattened: RenderNode[] = [];
    render(props.data, flattened);
    return flattened;
});

</script>

<template>
    <div class="textcomponent-container" >
        <span v-for="node in nodes" v-bind:style="node.style">{{ node.text }}</span>
    </div>
</template>


<style scoped>
.textcomponent-container span {
    white-space: pre;
}
</style>